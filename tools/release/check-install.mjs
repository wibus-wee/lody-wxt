import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

async function main() {
  const archive = path.resolve('dist/release/lody-chrome.zip');
  const report = path.resolve('reports/release-install');
  const directory = mkdtempSync(path.join(tmpdir(), 'lody-install-check-'));
  mkdirSync(report, { recursive: true });
  execFileSync('unzip', ['-q', archive, '-d', path.join(directory, 'download')]);
  const extension = path.join(directory, 'installed/lody');
  cpSync(path.join(directory, 'download/lody'), extension, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  const errors = [];
  let context;
  const launch = () =>
    chromium.launchPersistentContext(path.join(directory, 'profile'), {
      channel: 'chromium',
      headless: true,
      reducedMotion: 'reduce',
      viewport: { width: 400, height: 780 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
  try {
    context = await launch();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const version = await worker.evaluate(() => globalThis.chrome.runtime.getManifest().version);
    assert.equal(version, manifest.version);
    await worker.evaluate(() =>
      globalThis.chrome.storage.local.set({
        preferences: {
          mood: 'outline',
          displayName: 'Release install check',
          theme: 'dark',
          ambient: false,
        },
      }),
    );
    const options = await context.newPage();
    options.on('pageerror', (error) => errors.push(error.message));
    await options.goto(`chrome-extension://${id}/options.html#/settings`);
    await options.getByRole('heading', { name: 'Release install check', exact: true }).waitFor();
    assert.equal(await options.locator('main').getAttribute('data-theme'), 'dark');
    await options.getByRole('combobox', { name: '主题', exact: true }).waitFor();

    // Closing Chrome releases files on Windows; restarting reloads the same extension ID.
    await context.tracing.stop({ path: path.join(report, 'first-install.trace.zip') });
    await context.close();
    context = undefined;
    cpSync(path.join(directory, 'download/lody'), extension, { recursive: true });
    context = await launch();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const nextWorker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/options.html#/settings`);
    await page.getByRole('heading', { name: 'Release install check', exact: true }).waitFor();
    assert.equal(new URL(nextWorker.url()).host, id);
    const preferences = await nextWorker.evaluate(
      async () => (await globalThis.chrome.storage.local.get('preferences')).preferences,
    );
    assert.equal(preferences.displayName, 'Release install check');
    assert.equal(preferences.theme, 'dark');
    assert.equal(await page.locator('main').getAttribute('data-theme'), 'dark');
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    assert.deepEqual(axe.violations, []);
    await page.screenshot({ path: path.join(report, 'settings-after-reload.png') });
    await page.goto(`chrome-extension://${id}/options.html#/intro`);
    await page.getByRole('heading', { name: '随时问一句', exact: true }).waitFor();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('heading', { name: '把网页带进对话', exact: true }).waitFor();
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await page.getByRole('button', { name: '登录 Lody', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    writeFileSync(
      path.join(report, 'result.json'),
      `${JSON.stringify(
        {
          version,
          archiveSha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
          extensionId: id,
          browser: context.browser()?.version(),
          platform: process.platform,
          architecture: process.arch,
          sameDirectoryBrowserRestart: true,
          preferencesRetained: true,
          settingsAndSidepanelLoaded: true,
          introductionNavigation: true,
          axeViolations: axe.violations.length,
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(
      `Verified downloaded Lody ${version}: installation, same-directory browser restart, preserved preferences, settings and sidepanel. Axe: zero violations.\n`,
    );
  } finally {
    if (context) {
      await context.tracing.stop({ path: path.join(report, 'install.trace.zip') });
      await context.close();
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
