import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { expect } from '@playwright/test';
import { chromium } from 'playwright';

import { createUpdateIndex } from '../release/update-index.mjs';

const invalidDirectory = /不是当前扩展|无法验证所选目录/;
const pickerTitle = /^(?:Select|Open|Choose)/;
const byteRange = /^bytes=(\d+)-(\d+)$/;

async function main() {
  // Real packaged UI and native grants; only the release HTTP boundary is controlled.
  // Everything is scoped to disposable fixture directories and a fresh CI browser profile.
  const root = await mkdtemp(path.join(tmpdir(), 'lody-product-update-'));
  const extension = path.join(root, 'installed');
  const copied = path.join(root, 'wrong-copy');
  const target = path.join(root, 'target');
  const report = path.resolve('reports/directory-product');
  await mkdir(report, { recursive: true });
  await cp(path.resolve('.output/chrome-mv3'), extension, { recursive: true });
  await cp(extension, copied, { recursive: true });
  await cp(extension, target, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  const beforeVersion = manifest.version;
  const [major, minor, patch] = beforeVersion.split('.').map(Number);
  const nextVersion = `${major}.${minor}.${patch + 1}`;
  await writeFile(
    path.join(target, 'manifest.json'),
    JSON.stringify({ ...manifest, version: nextVersion }),
  );
  const archivePath = path.join(root, 'release.zip');
  execFileSync('python3', [
    '-I',
    '-c',
    `import pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED) as archive:
 for file in sorted(root.rglob('*')):
  if file.is_file(): archive.write(file,'lody/'+file.relative_to(root).as_posix())
`,
    target,
    archivePath,
  ]);
  const archive = await readFile(archivePath);
  const index = createUpdateIndex(archivePath, nextVersion);
  const config = JSON.parse(await readFile('src/features/updates/config.json', 'utf8'));
  const releaseRoot = `${config.repository}/releases/download/v${nextVersion}`;
  const feed = {
    schemaVersion: 1,
    application: 'lody-wxt',
    channel: 'stable',
    version: nextVersion,
    releaseNotesUrl: `${config.repository}/releases/tag/v${nextVersion}`,
    installationUrl: `${releaseRoot}/INSTALL.md`,
    enclosure: {
      url: `${releaseRoot}/lody-chrome.zip`,
      length: archive.length,
      sha256: index.archive.sha256,
      type: 'application/zip',
    },
  };
  const requests = [];
  const checkpoints = [];
  const pageErrors = [];
  let responseMode = 'corrupt-index';
  const context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
    channel: 'chromium',
    headless: false,
    viewport: { width: 1000, height: 850 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const screenshot = (name) =>
    execFileSync('import', ['-window', 'root', path.join(report, `${name}.png`)]);
  const key = (...keys) => execFileSync('xdotool', ['key', '--clearmodifiers', ...keys]);
  const installedVersion = async () =>
    JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8')).version;
  async function chooseDirectory(page, directory, label) {
    await page.getByRole('button', { name: '选择安装目录', exact: true }).click();
    let title = '';
    for (let attempt = 0; attempt < 100; attempt++) {
      title = execFileSync('xdotool', ['getactivewindow', 'getwindowname'], {
        encoding: 'utf8',
      }).trim();
      if (pickerTitle.test(title)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    screenshot(`${label}-picker`);
    assert.match(title, pickerTitle);
    const active = execFileSync('xdotool', ['getactivewindow'], { encoding: 'utf8' }).trim();
    execFileSync('xdotool', ['windowactivate', '--sync', active]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    key('ctrl+l');
    await new Promise((resolve) => setTimeout(resolve, 500));
    execFileSync('xdotool', ['type', '--clearmodifiers', directory]);
    // The retained picker image shows Open at the bottom-right of this GTK window.
    // Resolve its real geometry; product and synthetic browser viewports differ.
    const geometry = Object.fromEntries(
      execFileSync('xdotool', ['getwindowgeometry', '--shell', active], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );
    const x = Number(geometry.X) + Number(geometry.WIDTH) - 50;
    const y = Number(geometry.Y) + Number(geometry.HEIGHT) - 27;
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
    execFileSync('xdotool', ['mousemove', String(x), String(y), 'click', '1']);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    screenshot(`${label}-grant`);
    // Explicit fixture-only read/write grant. No CDP grant or API replacement.
    key('Tab');
    key('Return');
  }
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    await context.route(config.feedUrl, (route) => route.fulfill({ json: feed }));
    await context.route(`${releaseRoot}/update-index.json`, (route) =>
      route.fulfill({
        json:
          responseMode === 'corrupt-index'
            ? { ...index, archive: { ...index.archive, sha256: 'f'.repeat(64) } }
            : index,
      }),
    );
    await context.route(feed.enclosure.url, async (route) => {
      const headers = route.request().headers();
      requests.push({
        range: headers.range ?? null,
        mode: responseMode,
        authorization: !!headers.authorization,
        cookie: !!headers.cookie,
      });
      if (responseMode === 'http-failure')
        return route.fulfill({ status: 503, body: 'fixture unavailable' });
      const range = byteRange.exec(headers.range ?? '');
      assert.ok(range, 'Unchanged files must not force a full package request');
      const first = Number(range[1]);
      const last = Number(range[2]);
      assert.ok(first <= last && last < archive.length);
      await route.fulfill({
        status: 206,
        headers: { 'Content-Range': `bytes ${first}-${last}/${archive.length}` },
        body: archive.subarray(first, last + 1),
      });
    });
    const chromeSettings = await context.newPage();
    await chromeSettings.goto('chrome://extensions');
    const developerMode = chromeSettings.locator('extensions-manager extensions-toolbar #devMode');
    await developerMode.waitFor();
    if ((await developerMode.getAttribute('aria-pressed')) !== 'true') await developerMode.click();
    assert.equal(await developerMode.getAttribute('aria-pressed'), 'true');
    await chromeSettings.close();
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`chrome-extension://${id}/options.html#/settings`);
    const updates = page.getByRole('region', { name: '目录更新', exact: true });
    await expect(updates).toContainText('尚未绑定安装目录');
    await updates.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(report, '01-unbound.png'), fullPage: true });
    await chooseDirectory(page, copied, '02-wrong');
    await expect(updates).toContainText(invalidDirectory, { timeout: 15000 });
    await expect(updates).toContainText('尚未绑定安装目录');
    checkpoints.push('reject-copy-with-matching-manifest');
    await chooseDirectory(page, extension, '03-correct');
    await expect(updates).toContainText('安装目录：installed', { timeout: 15000 });
    await page.reload();
    await expect(updates).toContainText('安装目录：installed');
    checkpoints.push('native-binding-persists-across-page-reload');
    await page.getByRole('button', { name: '检查更新', exact: true }).click();
    await expect(page.getByRole('region', { name: '扩展更新', exact: true })).toContainText(
      `可用版本：${nextVersion}`,
    );
    const update = updates.getByRole('button', { name: '下载并写入更新', exact: true });
    await update.click();
    await expect(updates).toContainText('索引与已确认的发布包不匹配');
    assert.equal(await installedVersion(), beforeVersion);
    checkpoints.push('corrupt-index-rejected-before-write');
    responseMode = 'http-failure';
    await update.click();
    await expect(updates).toContainText('503');
    assert.equal(await installedVersion(), beforeVersion);
    checkpoints.push('download-failure-preserves-installation');
    responseMode = 'valid';
    await update.click();
    await expect(updates).toContainText(`已写入 ${nextVersion}`, { timeout: 30000 });
    assert.equal(await installedVersion(), nextVersion);
    const changed = index.files.find((file) => file.path === 'manifest.json');
    const expectedRange = `bytes=${changed.offset}-${changed.offset + changed.compressedSize - 1}`;
    assert.deepEqual(
      requests.filter((request) => request.mode === 'valid').map((request) => request.range),
      [expectedRange],
    );
    assert.ok(requests.every((request) => !request.authorization && !request.cookie));
    checkpoints.push('only-changed-manifest-downloaded-and-written');
    await updates.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(report, '04-written.png'), fullPage: true });
    await updates.getByRole('button', { name: '恢复更新前文件', exact: true }).click();
    await expect(updates).toContainText('已恢复更新前的文件');
    assert.equal(await installedVersion(), beforeVersion);
    checkpoints.push('visible-rollback-restores-original-version');
    await update.click();
    await expect(updates).toContainText(`已写入 ${nextVersion}`, { timeout: 30000 });
    const nextWorker = context.waitForEvent('serviceworker', {
      predicate: (candidate) => new URL(candidate.url()).host === id,
    });
    // Product currently asks for manual reload; exercise the browser's actual Reload control.
    const manager = await context.newPage();
    await manager.goto('chrome://extensions');
    await manager.locator(`extensions-item[id="${id}"] #dev-reload-button`).click();
    await nextWorker;
    const after = await context.newPage();
    await after.goto(`chrome-extension://${id}/options.html#/settings`);
    await expect(after.getByRole('region', { name: '扩展更新', exact: true })).toContainText(
      `当前版本：${nextVersion}`,
    );
    await expect(after.getByRole('region', { name: '目录更新', exact: true })).toContainText(
      '安装目录：installed',
    );
    await expect(after.getByRole('button', { name: '恢复更新前文件', exact: true })).toHaveCount(0);
    checkpoints.push('real-reload-confirms-version-and-clears-completed-journal');
    await after.getByRole('region', { name: '目录更新', exact: true }).scrollIntoViewIfNeeded();
    await after.screenshot({ path: path.join(report, '05-reloaded.png'), fullPage: true });
    assert.deepEqual(pageErrors, []);
  } finally {
    screenshot('final');
    await writeFile(
      path.join(report, 'result.json'),
      JSON.stringify(
        {
          head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          browser: context.browser()?.version(),
          beforeVersion,
          nextVersion,
          checkpoints,
          requests,
          pageErrors,
        },
        null,
        2,
      ),
    );
    await context.tracing.stop({ path: path.join(report, 'product.trace.zip') });
    await context.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
