import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, test } from '@playwright/test';

import { transcriptFixture } from '../fixtures/transcript';

test('development extension loads StyleX across surfaces and updates lazily compiled CSS', async () => {
  const extension = path.resolve('.output/extension-test/chrome-mv3-dev');
  await expect
    .poll(async () => {
      try {
        return await readFile(path.join(extension, 'sidepanel.html'), 'utf8');
      } catch {
        return '';
      }
    })
    .toContain('http://localhost:3081/virtual:stylex.css');
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-extension-dev-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 380, height: 780 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const panel = await context.newPage();
    const failures: string[] = [];
    panel.on('requestfailed', (request) => failures.push(request.url()));
    const cssRequests: string[] = [];
    panel.on('response', (response) => {
      if (response.url().includes('virtual:stylex.css') && response.ok())
        cssRequests.push(response.url());
    });
    await panel.goto(`${origin}/sidepanel.html`);
    await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toBeVisible();
    await expect(panel.locator('main')).toHaveCSS('display', 'flex');
    await expect(panel.getByRole('navigation', { name: 'Main' })).toHaveCSS('gap', '4px');
    await expect(panel.getByTestId('composer')).toBeVisible();
    await expect(panel.getByTestId('composer')).toHaveCSS('height', '96px');
    await expect(panel.getByTestId('composer')).toHaveCSS('border-top-width', '1px');
    await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toHaveCSS(
      'padding',
      '0px 4px',
    );
    await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toHaveCSS(
      'font-size',
      '14px',
    );
    await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    await expect.poll(() => panel.locator('#__stylex_virtual__').textContent()).toContain('flex');
    await expect.poll(() => cssRequests.length).toBeGreaterThan(1);
    expect(cssRequests.every((url) => url.startsWith('http://localhost:3081/'))).toBe(true);

    for (const surface of ['popup', 'options']) {
      const page = await context.newPage();
      await page.goto(`${origin}/${surface}.html`);
      await expect(page.locator('main')).toHaveCSS('display', 'flex');
      await expect.poll(() => page.locator('#__stylex_virtual__').textContent()).toContain('flex');
      await page.close();
    }

    const requestsBeforeImport = cssRequests.length;
    await panel.evaluate(async (moduleUrl) => {
      const { probe } = await import(moduleUrl);
      const element = document.createElement('div');
      element.id = 'stylex-lazy-probe';
      element.className = probe.className;
      document.body.appendChild(element);
    }, 'http://localhost:3081/tests/extension/fixtures/stylex.ts');
    await expect(panel.locator('#stylex-lazy-probe')).toHaveCSS('width', '133px');
    await expect(panel.locator('#stylex-lazy-probe')).toHaveCSS(
      'background-color',
      'rgb(12, 34, 56)',
    );
    expect(cssRequests.length).toBeGreaterThan(requestsBeforeImport);
    await panel.locator('#stylex-lazy-probe').evaluate((element) => element.remove());
    expect(failures.filter((url) => url.includes('virtual:stylex'))).toEqual([]);
    expect(
      (await new AxeBuilder({ page: panel }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    await panel.screenshot({ path: 'reports/dev-sidepanel.png' });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('development code-bearing history highlights in a same-origin worker without crashing', async () => {
  const extension = path.resolve('.output/extension-test/chrome-mv3-dev');
  await expect
    .poll(() => readFile(path.join(extension, 'markdown-highlight.js'), 'utf8'))
    .toContain('postMessage');
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-extension-worker-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 360, height: 780 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--enable-features=EnforceDedicatedWorkerSameOriginCheck',
    ],
  });
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const background = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const origin = `chrome-extension://${new URL(background.url()).host}`;
    const options = await context.newPage();
    await options.goto(`${origin}/options.html`);
    await options.evaluate(
      (history) =>
        (
          globalThis as unknown as {
            chrome: { storage: { local: { set: (value: object) => Promise<void> } } };
          }
        ).chrome.storage.local.set({ 'demo:workspace:history:v1': [history] }),
      transcriptFixture(),
    );
    await options.close();

    const panel = await context.newPage();
    const crashes: string[] = [];
    const errors: string[] = [];
    const workerUrls: string[] = [];
    panel.on('crash', () => crashes.push('sidepanel renderer crashed'));
    panel.on('pageerror', (error) => errors.push(error.message));
    panel.on('worker', (worker) => workerUrls.push(worker.url()));
    await panel.goto(`${origin}/sidepanel.html`);
    const fence = panel.locator('[data-streamdown="code-block"]').first();
    await expect(fence.locator('code span[style]')).not.toHaveCount(0);
    expect(workerUrls).toEqual([`${origin}/markdown-highlight.js`]);
    const code = await fence.locator('code').textContent();
    await fence.getByRole('button', { name: '代码自动换行' }).click();
    await expect(fence.locator('pre')).toHaveCSS('white-space', 'pre-wrap');
    await fence.getByRole('button', { name: '复制代码' }).click();
    await expect(fence.getByRole('button', { name: '复制代码' })).toHaveAttribute(
      'data-copied',
      'true',
    );
    expect(await panel.evaluate(() => navigator.clipboard.readText())).toBe(code);
    await panel.mouse.move(0, 0);
    expect(
      (await new AxeBuilder({ page: panel }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);

    const fallbackHighlighted = await panel.evaluate(async (moduleUrl) => {
      const { createCodeWorker } = await import(moduleUrl);
      const fallback = createCodeWorker();
      try {
        return await new Promise<boolean>((resolve, reject) => {
          fallback.onmessage = (event: MessageEvent<{ lines: unknown }>) =>
            resolve(Array.isArray(event.data.lines) && event.data.lines.length > 0);
          fallback.onerror = (event: ErrorEvent) => reject(new Error(event.message));
          fallback.postMessage({ id: 1, code: 'const stable = true;', language: 'typescript' });
        });
      } finally {
        fallback.terminate();
      }
    }, 'http://localhost:3081/src/shared/ui/create-code-worker.ts');
    expect(fallbackHighlighted).toBe(true);
    expect(workerUrls).toEqual([
      `${origin}/markdown-highlight.js`,
      `${origin}/markdown-highlight.js`,
    ]);

    workerUrls.length = 0;
    await panel.reload();
    await expect(fence.locator('code span[style]')).not.toHaveCount(0);
    await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toBeVisible();
    expect(workerUrls).toEqual([`${origin}/markdown-highlight.js`]);
    expect(crashes).toEqual([]);
    expect(errors).toEqual([]);
    await panel.screenshot({ path: 'reports/dev-transcript-worker.png' });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
