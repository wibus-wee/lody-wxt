import { Buffer } from 'node:buffer';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { chromium, expect, test } from '@playwright/test';

import { JourneyEvidence } from '../../tools/assurance/evidence';
import { captureSourceScreenshot } from '../../tools/autonomy/capture-ui.mjs';
import { AccountBoundary, signIn } from '../e2e/support/account-boundary';
import { RuntimeBoundary } from '../e2e/support/runtime-boundary';

test.use({ trace: 'off' });

async function launch(profile: string, extension = path.resolve('.output/chrome-mv3')) {
  return chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--enable-unsafe-extension-debugging',
    ],
  });
}
async function withPanel(
  variant: string,
  run: (
    panel: Page,
    context: BrowserContext,
    evidence: JourneyEvidence,
    cloud: RuntimeBoundary,
  ) => Promise<void>,
  grants = false,
) {
  const info = test.info();
  const evidence = new JourneyEvidence('capture-and-send-context', variant, 'extension');
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-extended-context-'));
  const grantExtension = grants
    ? await mkdtemp(path.join(tmpdir(), 'lody-extension-grants-'))
    : undefined;
  if (grantExtension) {
    await cp(path.resolve('.output/chrome-mv3'), grantExtension, { recursive: true });
    const manifestPath = path.join(grantExtension, 'manifest.json');
    const productionManifest = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(productionManifest);
    manifest.permissions.push('history', 'bookmarks');
    manifest.optional_permissions = manifest.optional_permissions.filter(
      (permission: string) => !new Set(['history', 'bookmarks']).has(permission),
    );
    await writeFile(manifestPath, JSON.stringify(manifest));
    const installation = await launch(profile, grantExtension);
    if (!installation.serviceWorkers().length) await installation.waitForEvent('serviceworker');
    await installation.close();
    await writeFile(manifestPath, productionManifest);
    await info.attach('permission-baseline', {
      body: 'Isolated extension install initially grants history/bookmarks; manifest restored byte-for-byte to production before the actual run. JS/CSP stay unchanged. Native permission prompt acceptance is not automated.',
      contentType: 'text/plain',
    });
  }
  const context = await launch(profile, grantExtension);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    await context.route('https://fixture-boundary.invalid/ready', (route) =>
      route.fulfill({ body: 'controlled' }),
    );
    await expect
      .poll(() =>
        worker.evaluate(async () => {
          try {
            return await (await fetch('https://fixture-boundary.invalid/ready')).text();
          } catch {
            return '';
          }
        }),
      )
      .toBe('controlled');
    await new AccountBoundary().install(context);
    const cloud = new RuntimeBoundary();
    await cloud.install(context);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    await signIn(panel);
    await panel.getByRole('button', { name: 'Workspace', exact: true }).click();
    await expect(panel.getByRole('button', { name: '运行配置', exact: true })).toContainText(
      'Controlled model',
    );
    await panel
      .getByRole('textbox', { name: '消息', exact: true, includeHidden: true })
      .fill('Keep this draft');
    if (variant === 'packaged-source-picker') {
      await panel.setViewportSize({ width: 640, height: 960 });
      await panel.evaluate(async () => {
        const chromeApi = (
          globalThis as typeof globalThis & {
            chrome: {
              tabs: {
                getCurrent: () => Promise<{ id: number }>;
                setZoom: (id: number, zoom: number) => Promise<void>;
              };
            };
          }
        ).chrome;
        await chromeApi.tabs.setZoom((await chromeApi.tabs.getCurrent()).id, 2);
      });
      await expect.poll(() => panel.evaluate(() => window.innerWidth)).toBe(320);
      await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toBeInViewport();
      await expect(panel.getByRole('button', { name: '附加上下文', exact: true })).toBeInViewport();
      await expect(panel.getByRole('button', { name: '运行配置', exact: true })).toBeInViewport();
      expect(
        await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await info.attach('native-browser-zoom-200-percent', {
        body: await panel.screenshot(),
        contentType: 'image/png',
      });
      await panel.evaluate(async () => {
        const chromeApi = (
          globalThis as typeof globalThis & {
            chrome: {
              tabs: {
                getCurrent: () => Promise<{ id: number }>;
                setZoom: (id: number, zoom: number) => Promise<void>;
              };
            };
          }
        ).chrome;
        await chromeApi.tabs.setZoom((await chromeApi.tabs.getCurrent()).id, 1);
      });
      await panel.setViewportSize({ width: 1280, height: 720 });
    }
    await run(panel, context, evidence, cloud);
    if (await panel.getByRole('dialog').count())
      await expect(panel.getByRole('dialog')).toHaveCSS('opacity', '1');
    expect((await new AxeBuilder({ page: panel }).analyze()).violations).toEqual([]);
  } finally {
    const trace = process.env.ASSURANCE_RUN_DIRECTORY
      ? `${process.env.ASSURANCE_RUN_DIRECTORY}/${variant}.trace.zip`
      : info.outputPath(`${variant}.trace.zip`);
    await context.tracing.stop({ path: trace });
    await info.attach('context-trace', { path: trace, contentType: 'application/zip' });
    if (process.env.ASSURANCE_RUN_DIRECTORY)
      await evidence.write(info.status === 'passed' ? 'passed' : 'failed', trace, info.testId);
    await context.close();
    await rm(profile, { recursive: true, force: true });
    if (grantExtension) await rm(grantExtension, { recursive: true, force: true });
  }
}
async function menu(panel: Page, label: string) {
  await panel.getByRole('button', { name: '附加上下文', exact: true }).click();
  if (label === '截图并裁剪…') {
    await panel.getByRole('menuitem', { name: label, exact: true }).click();
    return;
  }
  await panel.getByRole('menuitem', { name: '其他资料来源…', exact: true }).click();
  await panel
    .getByRole('dialog', { name: '其他资料来源', exact: true })
    .getByRole('button', { name: label, exact: true })
    .click();
}

async function inspectSourceNavigation(panel: Page) {
  const composer = panel.getByTestId('composer');
  const scope = panel.getByRole('region', { name: '网页范围', exact: true });
  const input = panel.getByRole('textbox', { name: '消息', exact: true });
  await expect(input).toHaveAttribute('placeholder', '问点什么…');
  for (const width of [320, 360, 420]) {
    await panel.setViewportSize({ width, height: 780 });
    await expect(scope).toBeInViewport();
    const box = (await composer.boundingBox())!;
    const contextBox = (await scope.boundingBox())!;
    const inputBox = (await input.boundingBox())!;
    expect(contextBox.y + contextBox.height).toBeLessThanOrEqual(box.y - 4);
    expect(inputBox.y - box.y).toBeGreaterThanOrEqual(10);
    expect(await composer.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await panel.setViewportSize({ width: 360, height: 780 });
  const currentPage = panel.getByRole('button', {
    name: '发送时读取当前页面',
    exact: true,
  });
  await expect(currentPage).toBeInViewport();
  await expect(currentPage).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByRole('button', { name: '选择标签页', exact: true })).toBeInViewport();
  await expect(panel.getByRole('button', { name: '语音输入', exact: true })).toBeInViewport();
  await expect(panel.getByRole('button', { name: '选择工具', exact: true })).toBeInViewport();
  await test.info().attach('compact-composer-360', {
    body: await panel.screenshot(),
    contentType: 'image/png',
  });
  const plus = panel.getByRole('button', { name: '附加上下文', exact: true });
  await plus.focus();
  await panel.keyboard.press('Enter');
  const items = panel.getByRole('menuitem');
  await expect(items).toHaveCount(3);
  await expect(items).toHaveText(['附加图片或文件…', '截图并裁剪…', '其他资料来源…']);
  await expect(panel.getByRole('menu')).toHaveCSS('opacity', '1');
  await test.info().attach('compact-attachment-menu-360', {
    body: await panel.screenshot(),
    contentType: 'image/png',
  });
  await panel.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await panel.keyboard.press('Enter');
  const sources = panel.getByRole('dialog', { name: '其他资料来源', exact: true });
  await expect(sources).toBeVisible();
  await expect(sources).toHaveCSS('opacity', '1');
  await expect(panel.locator('[role="menu"]')).toHaveCount(0);
  for (const name of [
    '附加当前页面',
    '附加选中文字',
    '附加链接…',
    '附加视频字幕',
    '书签与浏览历史…',
    '读取 PDF 文字…',
  ])
    await expect(sources.getByRole('button', { name, exact: true })).toBeInViewport();
  expect(await sources.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page: panel }).analyze()).violations).toEqual([]);
  await test.info().attach('compact-source-dialog-360', {
    body: await panel.screenshot(),
    contentType: 'image/png',
  });
  await panel.keyboard.press('Escape');
  await expect(sources).toHaveCount(0);
  await expect(plus).toBeFocused();
  await expect(currentPage).toHaveAttribute('aria-pressed', 'false');
  await currentPage.click();
  await expect(currentPage).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('context-card')).toHaveCount(0);
  await currentPage.click();
  await expect(currentPage).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByTestId('context-card')).toHaveCount(0);
  await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
    'Keep this draft',
  );
  await panel.setViewportSize({ width: 1280, height: 720 });
}

test('packaged source picker retains exact immutable snapshots and reports a closed source', async () => {
  await withPanel('packaged-source-picker', async (panel, context, evidence, cloud) => {
    await context.route('https://backend.lody.ai/source.pdf*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Selected source</title><main><p>Original snapshot</p><div id="shadow"></div><iframe srcdoc="<p>Same origin frame</p>"></iframe><p hidden>Hidden secret</p></main><script>document.querySelector("#shadow").attachShadow({mode:"open"}).innerHTML="<p>Open shadow content</p>";</script>',
      }),
    );
    await context.route('https://backend.lody.ai/closed-source', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Closing source</title><main>Do not substitute another page</main>',
      }),
    );
    const source = await context.newPage();
    await source.goto('https://backend.lody.ai/source.pdf?token=private#page=2');
    const closed = await context.newPage();
    await closed.goto('https://backend.lody.ai/closed-source');
    await evidence.check('denied-source-preserves-draft', async () => {
      await inspectSourceNavigation(panel);
      await panel.getByRole('button', { name: '选择标签页', exact: true }).click();
      await panel.getByRole('switch', { name: '选择 Selected source', exact: true }).click();
      await panel.getByRole('switch', { name: '选择 Closing source', exact: true }).click();
      await closed.close();
      await panel.getByRole('button', { name: '附加 2 个页面', exact: true }).click();
      await expect(panel.getByRole('dialog')).toContainText('No tab with id');
      await expect(
        panel.getByRole('textbox', { name: '消息', exact: true, includeHidden: true }),
      ).toHaveValue('Keep this draft');
      await expect(panel.getByTestId('context-card')).toHaveCount(1);
    });
    await panel.getByRole('button', { name: '关闭', exact: true }).click();
    await panel.getByRole('button', { name: '查看资料 Selected source', exact: true }).click();
    await evidence.check('chosen-tab-is-exact-source', async () => {
      await expect(panel.getByRole('dialog')).toContainText('Original snapshot');
      await expect(panel.getByRole('dialog')).toContainText('Open shadow content');
      await expect(panel.getByRole('dialog')).toContainText('Same origin frame');
      await expect(panel.getByRole('dialog')).not.toContainText('Hidden secret');
      await expect(panel.getByRole('dialog')).not.toContainText('Do not substitute');
    });
    await panel.keyboard.press('Escape');
    await source.evaluate(() => {
      document.querySelector('main')!.textContent =
        `Updated snapshot ${'Long visible article. '.repeat(1000)}`;
    });
    await panel.getByRole('button', { name: '查看资料 Selected source', exact: true }).click();
    await evidence.check('snapshot-immutable-until-explicit-refresh', async () => {
      await expect(panel.getByRole('dialog')).toContainText('页面已变化');
      await expect(panel.getByRole('dialog')).toContainText('Original snapshot');
      await expect(panel.getByRole('dialog')).not.toContainText('Updated snapshot');
      await panel.getByRole('button', { name: '更新快照', exact: true }).click();
      await panel.getByRole('button', { name: '查看资料 Selected source', exact: true }).click();
      await expect(panel.getByRole('dialog')).toContainText('Updated snapshot');
    });
    await evidence.check('truncation-and-safe-locator-visible', async () => {
      await expect(panel.getByRole('dialog')).toContainText('正文已截断');
      await expect(panel.getByRole('dialog').getByRole('link')).toHaveAttribute(
        'href',
        'https://backend.lody.ai/source.pdf#page=2',
      );
      await expect(panel.getByRole('dialog')).not.toContainText('token=private');
    });
    await panel.keyboard.press('Escape');
    await panel.getByRole('button', { name: '移除 Selected source', exact: true }).click();
    const composer = panel.getByRole('textbox', { name: '消息', exact: true });
    await composer.fill('Keep this draft @tab:Selected');
    await panel.getByRole('option', { name: /Selected source/ }).click();
    await evidence.check('inline-tab-mention-preserves-draft-without-send', async () => {
      await expect(composer).toHaveValue('Keep this draft ');
      await expect(panel.getByTestId('context-card')).toHaveCount(1);
      await panel.getByRole('button', { name: '查看资料 Selected source', exact: true }).click();
      await expect(panel.getByRole('dialog')).toContainText('Updated snapshot');
      expect(
        cloud.traffic.filter(
          (row) => row.kind === 'append' && row.stream.startsWith('workspace-a:s:'),
        ),
      ).toHaveLength(0);
    });
    await panel.keyboard.press('Escape');

    await composer.fill('Keep this draft @tab:Selected');
    const oldCandidate = panel.getByRole('option', { name: /Selected source/ });
    await expect(oldCandidate).toBeVisible();
    await source.goto('https://backend.lody.ai/source.pdf?changed=1#page=3');
    await oldCandidate.click();
    await expect(panel.getByRole('alert')).toContainText('来源页面已导航');
    await expect(composer).toHaveValue('Keep this draft @tab:Selected');
    await expect(panel.getByTestId('context-card')).toHaveCount(1);
    await panel.keyboard.press('Escape');

    // Pause the real page renderer while executeScript is pending; no capture API is replaced.
    const debuggerSession = await context.newCDPSession(source);
    await debuggerSession.send('Debugger.enable');
    const paused = new Promise<void>((resolve) =>
      debuggerSession.once('Debugger.paused', () => resolve()),
    );
    try {
      await composer.fill('Keep this draft ');
      await composer.fill('Keep this draft @tab:Selected');
      await expect(panel.getByRole('option', { name: /Selected source/ })).toBeVisible();
      await debuggerSession.send('Debugger.pause');
      await panel.getByRole('option', { name: /Selected source/ }).click();
      await paused;
      await expect(panel.getByRole('listbox', { name: '提及与命令' })).toHaveAttribute(
        'aria-busy',
        'true',
      );
      await composer.fill('A newer draft authored during capture');
      await debuggerSession.send('Debugger.resume');
      await source.evaluate(() => document.title);
      await evidence.check('stale-tab-mention-rejected', async () => {
        await expect(composer).toHaveValue('A newer draft authored during capture');
        await expect(panel.getByTestId('context-card')).toHaveCount(1);
        await panel.getByRole('button', { name: '查看资料 Selected source', exact: true }).click();
        await expect(panel.getByRole('dialog').getByRole('link')).toHaveAttribute(
          'href',
          'https://backend.lody.ai/source.pdf#page=2',
        );
        expect(
          cloud.traffic.filter(
            (row) => row.kind === 'append' && row.stream.startsWith('workspace-a:s:'),
          ),
        ).toHaveLength(0);
      });
    } finally {
      await debuggerSession.send('Debugger.disable');
      await debuggerSession.detach();
    }
  });
});

function pdfBytes(): Buffer {
  const stream = 'BT /F1 12 Tf 20 200 Td (Packaged PDF source) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let value = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(value.length);
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = value.length;
  value += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(value);
}

test('packaged PDF worker and visual attachments preserve drafts and reject changed sources', async () => {
  await withPanel(
    'packaged-document-image',
    async (panel, context, evidence) => {
      const violations: string[] = [];
      panel.on('console', (message) => {
        if (message.type() === 'error' && message.text().includes('Content Security Policy'))
          violations.push(message.text());
      });
      await menu(panel, '读取 PDF 文字…');
      await panel
        .getByLabel('选择 PDF 文件', { exact: true })
        .setInputFiles({ name: 'source.pdf', mimeType: 'application/pdf', buffer: pdfBytes() });
      await evidence.check('packaged-pdf-worker-and-page-markers', async () => {
        await expect(panel.getByRole('dialog')).toContainText('第 1 页');
        await expect(panel.getByRole('dialog')).toContainText('Packaged PDF source');
        expect(violations).toEqual([]);
        await panel.getByRole('button', { name: '附加带页码的文字', exact: true }).click();
        await expect(
          panel.getByRole('button', { name: '移除 source.pdf.txt', exact: true }),
        ).toBeVisible();
      });
      await menu(panel, '读取 PDF 文字…');
      await panel.getByLabel('选择 PDF 文件', { exact: true }).setInputFiles({
        name: 'fake.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('not a PDF'),
      });
      await evidence.check('invalid-or-scanned-pdf-keeps-draft', async () => {
        await expect(panel.getByRole('dialog').getByRole('alert')).toContainText('PDF 标识');
        await panel.getByRole('button', { name: '取消', exact: true }).click();
        await expect(
          panel.getByRole('textbox', { name: '消息', exact: true, includeHidden: true }),
        ).toHaveValue('Keep this draft');
        await expect(
          panel.getByRole('button', { name: '移除 source.pdf.txt', exact: true }),
        ).toBeVisible();
      });
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      );
      await panel
        .getByLabel('选择附件', { exact: true })
        .setInputFiles({ name: 'visible.png', mimeType: 'image/png', buffer: png });
      await evidence.check('real-image-preview-and-removal', async () => {
        await panel.getByRole('button', { name: '预览 visible.png', exact: true }).click();
        await expect(panel.getByRole('dialog').getByRole('img')).toBeVisible();
        expect(
          await panel
            .getByRole('dialog')
            .getByRole('img')
            .evaluate((image) => (image as HTMLImageElement).naturalWidth),
        ).toBe(1);
        await panel.keyboard.press('Escape');
        await panel.getByRole('button', { name: '移除 visible.png', exact: true }).click();
        await expect(
          panel.getByRole('button', { name: '预览 visible.png', exact: true }),
        ).toHaveCount(0);
      });
      await context.route('https://backend.lody.ai/race-*', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<title>Race source</title><main>Document before navigation</main>',
        }),
      );
      const source = await context.newPage();
      await source.goto('https://backend.lody.ai/race-one');
      await source.bringToFront();
      const browserSession = await context.browser()!.newBrowserCDPSession();
      const { targetInfos } = await browserSession.send('Target.getTargets', {
        filter: [{ type: 'tab' }],
      });
      const target = targetInfos.find((item) => item.url === source.url());
      expect(target).toBeDefined();
      await browserSession.send('Extensions.triggerAction', {
        id: new URL(panel.url()).host,
        targetId: target!.targetId,
      });
      await menu(panel, '截图并裁剪…');
      await expect(source.getByRole('dialog', { name: '截取可见内容' })).toBeVisible();
      await expect(panel.getByRole('dialog', { name: '附加截图' })).toHaveCount(0);
      await source.getByLabel('宽度（像素）', { exact: true }).fill('40');
      await source.getByLabel('高度（像素）', { exact: true }).fill('30');
      await source.getByRole('button', { name: '附加裁剪区域', exact: true }).click();
      await panel.getByRole('button', { name: '预览 区域截图.png', exact: true }).click();
      expect(
        await panel
          .getByRole('dialog')
          .getByRole('img')
          .evaluate((image) => [
            (image as HTMLImageElement).naturalWidth,
            (image as HTMLImageElement).naturalHeight,
          ]),
      ).toEqual([40, 30]);
      await panel.keyboard.press('Escape');
      await panel.getByRole('button', { name: '移除 区域截图.png', exact: true }).click();
      await panel.getByRole('button', { name: '选择标签页', exact: true }).click();
      await panel.getByRole('switch', { name: '选择 Race source', exact: true }).click();
      await source.goto('https://backend.lody.ai/race-two');
      await panel.getByRole('button', { name: '附加 1 个页面', exact: true }).click();
      await evidence.check('changed-document-capture-refused', async () => {
        await expect(panel.getByRole('dialog')).toContainText('来源页面已导航');
        await expect(panel.getByTestId('context-card')).toHaveCount(0);
        await expect(
          panel.getByRole('textbox', { name: '消息', exact: true, includeHidden: true }),
        ).toHaveValue('Keep this draft');
      });
    },
    false,
  );
});

test('packaged browser library manages explicit selections and revocable permissions', async () => {
  await withPanel(
    'packaged-browser-library',
    async (panel, _context, evidence) => {
      const manifest = JSON.parse(await readFile('.output/chrome-mv3/manifest.json', 'utf8'));
      const baseline = await panel.evaluate(async () => {
        const api = (
          globalThis as typeof globalThis & {
            chrome: {
              permissions: { getAll: () => Promise<{ permissions: string[] }> };
              bookmarks: {
                create: (item: { title: string; url?: string }) => Promise<{ id: string }>;
              };
            };
          }
        ).chrome;
        const permissions = await api.permissions.getAll();
        const folder = await api.bookmarks.create({ title: 'Assurance destination' });
        await api.bookmarks.create({
          title: 'Library fixture one',
          url: 'https://backend.lody.ai/one?secret=removed',
        });
        await api.bookmarks.create({
          title: 'Library fixture two',
          url: 'https://backend.lody.ai/two',
        });
        return { permissions, folderId: folder.id };
      });
      await menu(panel, '书签与浏览历史…');
      await evidence.check('library-permission-explicit', async () => {
        expect(manifest.permissions).not.toContain('bookmarks');
        expect(manifest.permissions).not.toContain('history');
        expect(manifest.optional_permissions).toEqual(
          expect.arrayContaining(['bookmarks', 'history']),
        );
        expect(baseline.permissions.permissions).toContain('bookmarks');
        await expect(panel.getByRole('dialog')).toContainText('最多显示 50 条');
        await expect(
          panel
            .getByRole('dialog')
            .getByRole('button', { name: '附加 Library fixture one', exact: true }),
        ).toHaveCount(0);
      });
      await panel.getByLabel('搜索书签或历史', { exact: true }).fill('Library fixture');
      await panel.getByRole('button', { name: '搜索并授权', exact: true }).click();
      await panel.getByRole('button', { name: '附加 Library fixture one', exact: true }).click();
      await panel.getByRole('button', { name: '关闭', exact: true }).click();
      await evidence.check('bounded-search-selected-link-only', async () => {
        await expect(panel.getByTestId('context-card')).toHaveCount(1);
        await panel
          .getByRole('button', { name: '查看资料 Library fixture one', exact: true })
          .click();
        await expect(panel.getByRole('dialog')).toContainText('尚未读取网页');
        await expect(panel.getByRole('dialog').getByRole('link')).toHaveAttribute(
          'href',
          'https://backend.lody.ai/one',
        );
        await expect(panel.getByRole('dialog')).not.toContainText('Library fixture two');
        await panel.keyboard.press('Escape');
      });
      await panel.evaluate(async () => {
        const api = (
          globalThis as typeof globalThis & {
            chrome: { history: { addUrl: (value: { url: string }) => Promise<void> } };
          }
        ).chrome;
        await Promise.all(
          Array.from({ length: 55 }, (_, index) =>
            api.history.addUrl({ url: `https://backend.lody.ai/library-history-${index}` }),
          ),
        );
      });
      await menu(panel, '书签与浏览历史…');
      await panel.getByRole('button', { name: '浏览历史', exact: true }).click();
      await panel.getByLabel('搜索书签或历史', { exact: true }).fill('library-history');
      await panel.getByLabel('限定域名', { exact: true }).fill('backend.lody.ai');
      await panel.getByRole('button', { name: '搜索并授权', exact: true }).click();
      await expect(panel.getByRole('dialog').getByRole('button', { name: /^附加 / })).toHaveCount(
        50,
      );
      await panel.getByRole('button', { name: '关闭', exact: true }).click();
      await menu(panel, '书签与浏览历史…');
      await panel.getByRole('button', { name: '新增书签', exact: true }).click();
      await panel.getByLabel('新书签名称', { exact: true }).fill('Created bookmark');
      await panel
        .getByLabel('新书签地址', { exact: true })
        .fill('https://backend.lody.ai/new-bookmark');
      await panel.getByRole('button', { name: '确认创建书签', exact: true }).click();
      await panel.getByRole('button', { name: '移动书签 Created bookmark', exact: true }).click();
      await panel.getByRole('combobox', { name: '目标书签文件夹', exact: true }).click();
      await panel.getByRole('option', { name: /Assurance destination/ }).click();
      await panel.getByRole('button', { name: '确认移动', exact: true }).click();
      await expect(panel.getByRole('dialog')).toContainText('书签已移动');
      const moved = await panel.evaluate(async () => {
        const api = (
          globalThis as typeof globalThis & {
            chrome: {
              bookmarks: {
                search: (query: string) => Promise<Array<{ title: string; parentId: string }>>;
              };
            };
          }
        ).chrome;
        return api.bookmarks.search('Created bookmark');
      });
      expect(moved[0]?.parentId).toBe(baseline.folderId);
      await panel.getByRole('button', { name: '删除书签 Created bookmark', exact: true }).click();
      await expect(panel.getByRole('dialog')).toContainText('确认删除书签');
      await panel.getByRole('button', { name: '确认删除', exact: true }).click();
      await evidence.check('bookmark-mutations-observed', async () => {
        await expect(panel.getByRole('dialog')).toContainText('书签已删除');
        expect(
          await panel.evaluate(async () =>
            (
              globalThis as typeof globalThis & {
                chrome: { bookmarks: { search: (query: string) => Promise<unknown[]> } };
              }
            ).chrome.bookmarks.search('Created bookmark'),
          ),
        ).toEqual([]);
      });
      await panel.getByRole('button', { name: '撤销权限', exact: true }).click();
      await evidence.check('revocation-prevents-next-query', async () => {
        await expect(panel.getByRole('dialog')).toContainText('已撤销浏览器访问权限');
        expect(
          await panel.evaluate(async () =>
            (
              globalThis as typeof globalThis & {
                chrome: {
                  permissions: {
                    contains: (permissions: { permissions: string[] }) => Promise<boolean>;
                  };
                };
              }
            ).chrome.permissions.contains({ permissions: ['bookmarks'] }),
          ),
        ).toBe(false);
        await expect(
          panel.getByRole('button', { name: '附加 Library fixture one', exact: true }),
        ).toHaveCount(0);
        await expect(panel.getByRole('button', { name: '搜索并授权', exact: true })).toBeVisible();
      });
    },
    true,
  );
});

test('denied screenshot permission preserves the draft and a later explicit capture sends once', async () => {
  await withPanel('permission-denied', async (panel, context, evidence, cloud) => {
    const origin = 'https://backend.lody.ai';
    await context.route(`${origin}/article`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Permission recovery source</title><main>Explicitly authorized article.</main>',
      }),
    );
    const source = await context.newPage();
    await source.goto(`${origin}/article`);
    await source.bringToFront();
    await menu(panel, '截图并裁剪…');
    await evidence.check('denial-visible', async () => {
      await expect(panel.getByRole('alert')).toContainText('临时截图权限');
      await expect(panel.getByRole('dialog', { name: '附加截图' })).toHaveCount(0);
    });
    await evidence.check('draft-unchanged', async () => {
      await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
        'Keep this draft',
      );
      await expect(panel.getByTestId('context-card')).toHaveCount(0);
      expect(
        cloud.traffic.filter(
          (row) => row.kind === 'append' && row.stream.startsWith('workspace-a:s:'),
        ),
      ).toEqual([]);
      await panel.reload();
      await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
        'Keep this draft',
      );
    });
    await source.bringToFront();
    const browserSession = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await browserSession.send('Target.getTargets', {
      filter: [{ type: 'tab' }],
    });
    const target = targetInfos.find((item) => item.url === source.url());
    expect(target).toBeDefined();
    await browserSession.send('Extensions.triggerAction', {
      id: new URL(panel.url()).host,
      targetId: target!.targetId,
    });
    await test.info().attach('permission-boundary', {
      body: 'Production manifest grants the fixture host but Chrome denies captureVisibleTab without activeTab. CDP invokes the real toolbar action to grant the temporary tab permission. The same screenshot action then succeeds. Native optional-host permission-dialog acceptance/refusal is outside this evidence.',
      contentType: 'text/plain',
    });
    await menu(panel, '截图并裁剪…');
    await expect(source.getByRole('dialog', { name: '截取可见内容' })).toBeVisible();
    await expect(panel.getByRole('dialog', { name: '附加截图' })).toHaveCount(0);
    await source.getByLabel('宽度（像素）', { exact: true }).fill('40');
    await source.getByLabel('高度（像素）', { exact: true }).fill('30');
    await source.getByRole('button', { name: '附加裁剪区域', exact: true }).click();
    await panel.getByRole('button', { name: '预览 区域截图.png', exact: true }).click();
    expect(
      await panel
        .getByRole('dialog')
        .getByRole('img')
        .evaluate((image) => [
          (image as HTMLImageElement).naturalWidth,
          (image as HTMLImageElement).naturalHeight,
        ]),
    ).toEqual([40, 30]);
    await panel.keyboard.press('Escape');
    await panel.getByRole('button', { name: '移除 区域截图.png', exact: true }).click();
    await source.bringToFront();
    await menu(panel, '附加当前页面');
    await evidence.check('later-explicit-capture-works', async () => {
      await panel
        .getByRole('button', { name: '查看资料 Permission recovery source', exact: true })
        .click();
      await expect(panel.getByRole('dialog')).toContainText('Explicitly authorized article.');
      await panel.keyboard.press('Escape');
      await panel.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toContainText(
        'Keep this draft',
      );
      const streams = [
        ...new Set(
          cloud.traffic
            .filter((row) => row.kind === 'append' && row.stream.startsWith('workspace-a:s:'))
            .map((row) => row.stream),
        ),
      ];
      expect(streams).toHaveLength(1);
      const sessionId = streams[0]!.slice('workspace-a:s:'.length);
      expect(cloud.document(sessionId).getList('history').length).toBe(1);
      expect(cloud.submittedTurn(sessionId).inputConfig.prompt).toContain(
        'Explicitly authorized article.',
      );
      expect(cloud.submittedTurn(sessionId).inputConfig.prompt).toContain('Keep this draft');
      cloud.beginReply(sessionId);
      cloud.finishReply(sessionId);
      await expect(
        panel.getByText('网页分析完成：这是一个协作项目。', { exact: true }),
      ).toBeVisible();
    });
  });
});

test('screenshot selection runs inside the source page and preserves the owning draft', async () => {
  test.setTimeout(90_000);
  await withPanel('packaged-screenshot-overlay', async (panel, context, evidence, cloud) => {
    const existingPages = new Set(context.pages());
    await captureSourceScreenshot(context, panel, 'overlay', expect);
    for (const page of context.pages()) if (!existingPages.has(page)) await page.close();

    const origin = 'https://backend.lody.ai';
    await context.route(`${origin}/overlay-*`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><title>Screenshot source</title><style>body{margin:0;background:rgb(240,80,40);font-size:50px}button,input{opacity:.2}main{height:2000px}</style><main><button>Page action</button><input aria-label="Page field"></main><aside style="position:fixed;right:0;top:0;width:220px;font-size:14px"><label>Password<input type="password" aria-label="Fixture password"></label><label>Code<input autocomplete="one-time-code" aria-label="Fixture code"></label><p data-sensitive>Public fixture marked by the page</p></aside></html>',
      }),
    );
    const source = await context.newPage();
    await source.setViewportSize({ width: 1000, height: 800 });
    await source.goto(`${origin}/overlay-one`);
    await source.getByRole('button', { name: 'Page action' }).focus();
    await source.bringToFront();
    const browserSession = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await browserSession.send('Target.getTargets', {
      filter: [{ type: 'tab' }],
    });
    const target = targetInfos.find((item) => item.url === source.url());
    expect(target).toBeDefined();
    await browserSession.send('Extensions.triggerAction', {
      id: new URL(panel.url()).host,
      targetId: target!.targetId,
    });
    // Empty credential fields and a page-provided marker must not veto an explicit capture.
    await expect(source.getByLabel('Fixture password', { exact: true })).toBeVisible();
    await expect(source.getByLabel('Fixture code', { exact: true })).toBeVisible();
    await expect(source.locator('[data-sensitive]')).toBeVisible();
    await test.info().attach('explicit-capture-source', {
      body: await source.screenshot(),
      contentType: 'image/png',
    });
    await menu(panel, '截图并裁剪…');
    await test.info().attach('explicit-capture-result', {
      body: await panel.screenshot(),
      contentType: 'image/png',
    });
    const overlay = source.getByRole('dialog', { name: '截取可见内容' });
    await evidence.check('overlay-isolated-accessible-and-no-panel-dialog', async () => {
      await expect(overlay).toBeVisible();
      await test.info().attach('explicit-capture-overlay', {
        body: await source.screenshot(),
        contentType: 'image/png',
      });
      await expect(panel.getByRole('dialog')).toHaveCount(0);
      await expect(overlay.getByRole('button', { name: '取消', exact: true })).toBeFocused();
      await expect(overlay.getByRole('button', { name: '附加整张截图' })).toHaveCSS(
        'font-size',
        '13px',
      );
      expect(
        (await new AxeBuilder({ page: source }).include('lody-screenshot').analyze()).violations,
      ).toEqual([]);
      const manifest = JSON.parse(await readFile('.output/chrome-mv3/manifest.json', 'utf8'));
      expect(manifest.content_scripts).toBeUndefined();
      expect(manifest.host_permissions).not.toContain('<all_urls>');
      expect(manifest.host_permissions).not.toContain('https://*/*');
      await source.keyboard.press('Tab');
      await source.keyboard.press('Tab');
      await expect(overlay.getByRole('button', { name: '附加整张截图' })).toBeFocused();
      await source.keyboard.press('Tab');
      await expect(overlay.getByLabel('左边距（像素）', { exact: true })).toBeFocused();
      await source.keyboard.press('Shift+Tab');
      await expect(overlay.getByRole('button', { name: '附加整张截图' })).toBeFocused();
    });
    const imageSize = await overlay
      .getByRole('img')
      .evaluate((image) => [
        (image as HTMLImageElement).naturalWidth,
        (image as HTMLImageElement).naturalHeight,
      ]);
    await source.mouse.move(100, 100);
    await source.mouse.down();
    await source.mouse.move(220, 180);
    await source.mouse.up();
    await evidence.check('pointer-crop-matches-screenshot-pixels', async () => {
      const width =
        Math.round((220 * imageSize[0]!) / 1000) - Math.round((100 * imageSize[0]!) / 1000);
      const height =
        Math.round((180 * imageSize[1]!) / 800) - Math.round((100 * imageSize[1]!) / 800);
      await expect(overlay.getByLabel('宽度（像素）', { exact: true })).toHaveValue(String(width));
      await expect(overlay.getByLabel('高度（像素）', { exact: true })).toHaveValue(String(height));
      await overlay.getByLabel('宽度（像素）', { exact: true }).fill(String(imageSize[0]! + 1));
      await overlay.getByRole('button', { name: '附加裁剪区域' }).click();
      await expect(overlay.getByRole('alert')).toContainText('裁剪范围');
      await overlay.getByLabel('宽度（像素）', { exact: true }).fill(String(width));
      await overlay.getByRole('button', { name: '附加裁剪区域' }).click();
      await expect(source.locator('lody-screenshot')).toHaveCount(0);
      await panel.getByRole('button', { name: '预览 区域截图.png', exact: true }).click();
      const pixels = await panel
        .getByRole('dialog')
        .getByRole('img')
        .evaluate((element) => {
          const image = element as HTMLImageElement;
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          return {
            width: canvas.width,
            height: canvas.height,
            color: [...context.getImageData(10, 10, 1, 1).data],
          };
        });
      expect(pixels).toEqual({ width, height, color: [240, 80, 40, 255] });
      await panel.keyboard.press('Escape');
      await panel.getByRole('button', { name: '移除 区域截图.png', exact: true }).click();
    });
    await source.bringToFront();
    await menu(panel, '截图并裁剪…');
    await evidence.check('full-screenshot-excludes-overlay', async () => {
      const fullSize = await overlay
        .getByRole('img')
        .evaluate((image) => [
          (image as HTMLImageElement).naturalWidth,
          (image as HTMLImageElement).naturalHeight,
        ]);
      await overlay.getByRole('button', { name: '附加整张截图' }).click();
      await expect(source.locator('lody-screenshot')).toHaveCount(0);
      await panel.getByRole('button', { name: '预览 页面截图.png', exact: true }).click();
      expect(
        await panel
          .getByRole('dialog')
          .getByRole('img')
          .evaluate((element) => {
            const image = element as HTMLImageElement;
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            return [
              image.naturalWidth,
              image.naturalHeight,
              [
                ...context.getImageData(
                  Math.floor(image.naturalWidth / 2),
                  image.naturalHeight - 20,
                  1,
                  1,
                ).data,
              ],
            ];
          }),
      ).toEqual([...fullSize, [240, 80, 40, 255]]);
      await panel.keyboard.press('Escape');
      await panel.getByRole('button', { name: '移除 页面截图.png', exact: true }).click();
    });
    await source.bringToFront();
    await menu(panel, '截图并裁剪…');
    await expect(overlay).toBeVisible();
    await evidence.check('cancel-preserves-draft-and-page', async () => {
      await source.keyboard.press('Escape');
      await expect(source.locator('lody-screenshot')).toHaveCount(0);
      await expect(source.getByRole('button', { name: 'Page action' })).toBeFocused();
      await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
        'Keep this draft',
      );
      await expect(panel.getByRole('button', { name: /^预览 .*截图\.png$/ })).toHaveCount(0);
      expect(
        cloud.traffic.filter(
          (row) => row.kind === 'append' && row.stream.startsWith('workspace-a:s:'),
        ),
      ).toEqual([]);
    });
    await source.bringToFront();
    await menu(panel, '截图并裁剪…');
    await expect(overlay).toBeVisible();
    await source.goto(`${origin}/overlay-two`);
    await evidence.check('source-navigation-cleans-overlay', async () => {
      await expect(source.locator('lody-screenshot')).toHaveCount(0);
      await expect(panel.getByRole('alert')).toContainText('来源网页或截图工具已关闭');
      await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
        'Keep this draft',
      );
      await expect(panel.getByRole('button', { name: /^预览 .*截图\.png$/ })).toHaveCount(0);
    });
    await expect(panel.getByRole('menu', { includeHidden: true })).toHaveCount(0);
  });
});
