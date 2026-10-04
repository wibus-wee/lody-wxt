import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium, expect, test } from '@playwright/test';

import { AccountBoundary, signIn } from '../e2e/support/account-boundary';
import { RuntimeBoundary } from '../e2e/support/runtime-boundary';

for (const origin of ['https://backend.lody.ai', 'http://capture.lody.test']) {
  test(`packaged capture on ${origin} preserves text and sends one prompt`, async () => {
    const profile = await mkdtemp(path.join(tmpdir(), 'lody-page-capture-'));
    const extension = path.resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      await new AccountBoundary().install(context);
      const cloud = new RuntimeBoundary();
      await cloud.install(context);
      await context.route(`${origin}/capture-fixture*`, (route) =>
        route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><html lang="en"><head><title>Capture fixture</title></head><body>
        <article hidden>Hidden template</article>
        <nav>Navigation only</nav>
        <main><h1>Visible article</h1><p id="passage">Read <strong>this phrase</strong> and <a href="/">its link</a>.</p>
        <p>Second paragraph.</p><p>中文「<strong>网页</strong>」内容<br>下一行</p><p hidden>Hidden secret</p><p style="display:none">CSS secret</p>
        <form>Form secret<input value="Password secret"></form><div contenteditable>Editable secret</div>
        <p data-sensitive>Sensitive secret</p></main><aside>Unrelated sidebar</aside>
      </body></html>`,
        }),
      );
      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
      await signIn(panel);
      await panel.getByRole('button', { name: 'Workspace', exact: true }).click();
      await expect(panel.getByRole('button', { name: '运行配置', exact: true })).toContainText(
        'Controlled model',
      );
      const grantedOrigins = () =>
        panel.evaluate(async () => {
          const api = (
            globalThis as typeof globalThis & {
              chrome: { permissions: { getAll: () => Promise<{ origins?: string[] }> } };
            }
          ).chrome;
          return (await api.permissions.getAll()).origins ?? [];
        });
      expect(await grantedOrigins()).not.toContain('http://*/*');
      const source = await context.newPage();
      await source.goto(`${origin}/capture-fixture?token=private#section`);
      await source.bringToFront();
      if (origin.startsWith('http:')) {
        const tab = await panel.evaluate(async () => {
          const api = (
            globalThis as typeof globalThis & {
              chrome: {
                tabs: {
                  query: (query: {
                    active: boolean;
                    currentWindow: boolean;
                  }) => Promise<{ url?: string }[]>;
                };
              };
            }
          ).chrome;
          return (await api.tabs.query({ active: true, currentWindow: true }))[0];
        });
        expect(tab?.url).toBe(`${origin}/capture-fixture?token=private#section`);
        expect(await grantedOrigins()).not.toContain(`${origin}/*`);
        const settings = await context.newPage();
        await settings.goto('chrome://extensions');
        await settings.evaluate(
          async (options) => {
            const api = (
              globalThis as typeof globalThis & {
                chrome: {
                  developerPrivate: {
                    addHostPermission: (extensionId: string, host: string) => Promise<void>;
                  };
                };
              }
            ).chrome;
            await api.developerPrivate.addHostPermission(options.extensionId, options.host);
          },
          { extensionId: new URL(worker.url()).host, host: `${origin}/*` },
        );
        await settings.close();
        expect(await grantedOrigins()).not.toContain('http://*/*');
        await source.bringToFront();
      }
      await panel.getByRole('textbox', { name: '消息', exact: true }).fill('Keep my draft');
      await panel.getByRole('button', { name: '附加上下文', exact: true }).click();
      await panel.getByRole('menuitem', { name: '附加选中文字', exact: true }).click();
      await expect(panel.getByRole('alert')).toContainText('请先在网页中选中文字');
      await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
        'Keep my draft',
      );
      await expect(panel.getByTestId('context-card')).toHaveCount(0);
      await panel.getByRole('button', { name: '附加上下文', exact: true }).click();
      await panel.getByRole('menuitem', { name: '附加当前页面', exact: true }).click();
      await expect(
        panel.getByRole('button', { name: '查看资料 Capture fixture', exact: true }),
      ).toBeVisible();
      await panel.getByRole('button', { name: '查看资料 Capture fixture', exact: true }).click();
      const preview = panel.getByRole('dialog');
      await expect(preview).toContainText('Visible article');
      await expect(preview.locator('p').last()).toHaveText(
        'Visible article\nRead this phrase and its link.\nSecond paragraph.\n中文「网页」内容\n下一行',
      );
      await expect(preview.getByRole('link')).toHaveAttribute('href', `${origin}/capture-fixture`);
      await expect(preview).not.toContainText('secret');
      await expect(preview).not.toContainText('Navigation only');
      await panel.keyboard.press('Escape');
      await source.evaluate(() => {
        const passage = document.querySelector('#passage')!;
        const range = document.createRange();
        range.setStart(passage.querySelector('strong')!.firstChild!, 2);
        range.setEnd(passage.querySelector('a')!.firstChild!, 6);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
      });
      await source.bringToFront();
      await panel.getByRole('button', { name: '附加上下文', exact: true }).click();
      await panel.getByRole('menuitem', { name: '附加选中文字', exact: true }).click();
      await expect(
        panel.getByRole('button', { name: '查看资料 Capture fixture', exact: true }),
      ).toHaveCount(2);
      await panel
        .getByRole('button', { name: '查看资料 Capture fixture', exact: true })
        .last()
        .click();
      await expect(preview.locator('p').last()).toHaveText('is phrase and its li');
      await panel.keyboard.press('Escape');
      await panel
        .getByRole('textbox', { name: '消息', exact: true })
        .fill('Explain these references');
      await panel.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toContainText(
        'Explain these references',
      );
      await expect(panel.getByLabel('附加的网页').getByRole('listitem')).toHaveCount(2);
      const streams = [
        ...new Set(
          cloud.traffic
            .filter((row) => row.kind === 'append' && row.stream.startsWith('workspace-a:s:'))
            .map((row) => row.stream),
        ),
      ];
      expect(streams).toHaveLength(1);
      const turn = cloud.submittedTurn(streams[0]!.slice('workspace-a:s:'.length));
      expect(turn.inputConfig.inputBlocks).toEqual([
        { type: 'text', text: turn.inputConfig.prompt },
      ]);
      expect(turn.inputConfig.prompt).toContain('Read this phrase and its link.');
      expect(turn.inputConfig.prompt).toContain('is phrase and its li');
      expect(turn.inputConfig.prompt).not.toContain('secret');
      expect(turn.inputConfig.prompt).not.toContain('token=private');
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
