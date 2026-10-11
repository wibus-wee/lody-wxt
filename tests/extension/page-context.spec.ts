import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, test } from '@playwright/test';

import { JourneyEvidence } from '../../tools/assurance/evidence';
import { AccountBoundary, signIn } from '../e2e/support/account-boundary';
import { RuntimeBoundary } from '../e2e/support/runtime-boundary';

// Persistent contexts retain their own success traces for assurance receipts.
test.use({ trace: 'off' });

for (const origin of ['https://backend.lody.ai', 'http://capture.lody.test']) {
  test(`packaged capture on ${origin} preserves text and sends one prompt`, async () => {
    // This lifecycle captures eight sources, checks three layouts and runs axe.
    test.setTimeout(60_000);
    const testInfo = test.info();
    const profile = await mkdtemp(path.join(tmpdir(), 'lody-page-capture-'));
    const extension = path.resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    context.setDefaultTimeout(10_000);
    context.setDefaultNavigationTimeout(15_000);
    const evidence = origin.startsWith('https:')
      ? new JourneyEvidence('capture-and-send-context', 'packaged-selection', 'extension')
      : null;
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      await new AccountBoundary().install(context);
      const agentPrompt = 'Follow the configured Agent instructions.';
      const cloud = new RuntimeBoundary({
        agent: { cliType: 'builtin', agentType: 'claude', prompt: agentPrompt },
        defaultMcp: true,
      });
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
        await test.step('grant only the HTTP fixture origin', async () => {
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
          expect(await grantedOrigins()).not.toContain('http://*/*');
        });
        await settings.close();
        await source.bringToFront();
      }
      await panel.getByRole('textbox', { name: '消息', exact: true }).fill('Keep my draft');
      await panel.getByRole('button', { name: '附加上下文', exact: true }).click();
      await panel.getByRole('menuitem', { name: '其他资料来源…', exact: true }).click();
      await panel
        .getByRole('dialog', { name: '其他资料来源', exact: true })
        .getByRole('button', { name: '附加选中文字', exact: true })
        .click();
      await expect(panel.getByRole('alert')).toContainText('请先在网页中选中文字');
      await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
        'Keep my draft',
      );
      await expect(panel.getByTestId('context-card')).toHaveCount(0);
      await panel.getByRole('button', { name: '附加上下文', exact: true }).click();
      await panel.getByRole('menuitem', { name: '其他资料来源…', exact: true }).click();
      await panel
        .getByRole('dialog', { name: '其他资料来源', exact: true })
        .getByRole('button', { name: '附加当前页面', exact: true })
        .click();
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
      const sanitized = async () => {
        await expect(preview).not.toContainText('secret');
        await expect(preview).not.toContainText('Navigation only');
        await expect(preview.getByRole('link')).toHaveAttribute(
          'href',
          `${origin}/capture-fixture`,
        );
      };
      if (evidence) await evidence.check('secret-content-excluded', sanitized);
      else await sanitized();
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
      await panel.getByRole('menuitem', { name: '其他资料来源…', exact: true }).click();
      await panel
        .getByRole('dialog', { name: '其他资料来源', exact: true })
        .getByRole('button', { name: '附加选中文字', exact: true })
        .click();
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
        .getByRole('button', { name: '移除 Capture fixture', exact: true })
        .first()
        .click();
      const removed = async () => {
        await expect(panel.getByTestId('context-card')).toHaveCount(1);
        await panel.getByRole('button', { name: '查看资料 Capture fixture', exact: true }).click();
        await expect(preview.locator('p').last()).toHaveText('is phrase and its li');
        await panel.keyboard.press('Escape');
      };
      if (evidence) await evidence.check('preview-and-removal-observed', removed);
      else await removed();
      await panel.getByRole('button', { name: 'Settings', exact: true }).click();
      await panel.reload();
      await panel.getByRole('button', { name: '返回对话', exact: true }).click();
      const restored = async () => {
        await expect(panel.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
          'Keep my draft',
        );
        await expect(panel.getByTestId('context-card')).toHaveCount(1);
        await panel.getByRole('button', { name: '查看资料 Capture fixture', exact: true }).click();
        await expect(preview.locator('p').last()).toHaveText('is phrase and its li');
        await panel.keyboard.press('Escape');
      };
      if (evidence) await evidence.check('context-restored-after-reload', restored);
      else await restored();
      const extraTitles = Array.from({ length: 7 }, (_, index) =>
        index < 2
          ? 'Menu · Raycast UI'
          : `资料 ${index + 1} — ${'LongUnbrokenPageTitle'.repeat(6)}`,
      );
      for (const [index, title] of extraTitles.entries()) {
        await source.evaluate(
          ({ title, index }) => {
            document.title = title;
            document.querySelector('main')!.textContent = `Additional source ${index + 1}`;
          },
          { title, index },
        );
        await source.bringToFront();
        await panel.getByRole('button', { name: '附加上下文', exact: true }).click();
        await panel.getByRole('menuitem', { name: '其他资料来源…', exact: true }).click();
        await panel
          .getByRole('dialog', { name: '其他资料来源', exact: true })
          .getByRole('button', { name: '附加当前页面', exact: true })
          .click();
        await expect(panel.getByTestId('context-card')).toHaveCount(index + 2);
      }
      await panel
        .getByRole('textbox', { name: '消息', exact: true })
        .fill('Explain these references');
      await panel.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toContainText(
        'Explain these references',
      );
      // Capturing needs the source tab active; layout and axe need the panel active.
      await panel.bringToFront();
      const sentMessage = panel.getByRole('article', { name: '你的消息', exact: true });
      await expect(
        sentMessage.getByRole('group', { name: '已附加的网页资料', exact: true }),
      ).toHaveCount(1);
      const cards = sentMessage.getByTestId('context-card');
      await expect(cards).toHaveCount(8);
      await expect(sentMessage).not.toContainText(agentPrompt);
      for (const width of [320, 360, 420]) {
        await panel.setViewportSize({ width, height: 780 });
        const bounds = await sentMessage.boundingBox();
        expect(bounds).not.toBeNull();
        for (const card of await cards.all()) {
          const box = await card.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
          expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
        }
        const strip = sentMessage.getByRole('group', { name: '已附加的网页资料', exact: true });
        expect(await strip.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        expect(
          await panel
            .getByRole('region', { name: '消息记录', exact: true })
            .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
        ).toBe(true);
        expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      await testInfo.attach('sent-page-attachments-420', {
        body: await panel.screenshot(),
        contentType: 'image/png',
      });
      await test.step('audit the foreground panel accessibility', async () => {
        expect((await new AxeBuilder({ page: panel }).analyze()).violations).toEqual([]);
      });
      const lastCard = cards.last().getByRole('button');
      await lastCard.focus();
      await panel.keyboard.press('Enter');
      await expect(preview).toContainText('Additional source 7');
      await panel.keyboard.press('Escape');
      await expect(lastCard).toBeFocused();
      await sentMessage
        .getByRole('button', { name: '查看资料 Capture fixture', exact: true })
        .click();
      await expect(preview.locator('p').last()).toHaveText('is phrase and its li');
      await panel.keyboard.press('Escape');
      const streams = [
        ...new Set(
          cloud.traffic
            .filter((row) => row.kind === 'append' && row.stream.startsWith('workspace-a:s:'))
            .map((row) => row.stream),
        ),
      ];
      expect(streams).toHaveLength(1);
      const sessionId = streams[0]!.slice('workspace-a:s:'.length);
      const turn = cloud.submittedTurn(sessionId);
      expect(turn.inputConfig.inputBlocks).toEqual([
        { type: 'text', text: String(turn.inputConfig.prompt).slice(agentPrompt.length + 2) },
      ]);
      const sent = () => {
        expect(cloud.sessionMetadata(sessionId)).toMatchObject({
          id: sessionId,
          machineId: 'machine-a',
          agentConfigId: 'agent-a',
          cliType: 'builtin',
          agentType: 'claude',
          status: { type: 'idle' },
          historyBackend: 'loro',
          title: 'Explain these references',
          titleSource: 'draft',
          lastMessageAt: Date.parse(turn.timestamp),
          latestUserMsgId: turn.requestId,
        });
        expect(String(turn.inputConfig.prompt).startsWith(`${agentPrompt}\n\n`)).toBe(true);
        expect(turn.inputConfig.mcpServerIds).toEqual(['research-stdio']);
        expect(cloud.document(sessionId).getList('history').toJSON()[0]).toMatchObject({
          read: false,
          role: 'user',
          status: 'pending',
          finished: true,
        });
        expect(turn.inputConfig.prompt).not.toContain('Read this phrase and its link.');
        expect(turn.inputConfig.prompt).toContain('is phrase and its li');
        for (let index = 1; index <= 7; index++) {
          expect(turn.inputConfig.prompt).toContain(`Additional source ${index}`);
        }
        expect(turn.inputConfig.prompt).toContain('Untrusted webpage references');
        expect(turn.inputConfig.prompt).not.toContain('secret');
        expect(turn.inputConfig.prompt).not.toContain('token=private');
        expect(
          cloud.document(streams[0]!.slice('workspace-a:s:'.length)).getList('history').length,
        ).toBe(1);
      };
      if (evidence) await evidence.check('only-retained-context-sent', sent);
      else sent();
      cloud.beginReply(sessionId);
      cloud.finishReply(sessionId);
      await expect(
        panel.getByText('网页分析完成：这是一个协作项目。', { exact: true }),
      ).toBeVisible();
      await test.step('restore the selected conversation and submit a continuation', async () => {
        await panel.reload({ waitUntil: 'domcontentloaded' });
        await expect(panel.getByRole('button', { name: '运行配置', exact: true })).toContainText(
          'Controlled model',
        );
        await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toContainText(
          'Explain these references',
        );
        await expect(
          panel.getByText('网页分析完成：这是一个协作项目。', { exact: true }),
        ).toBeVisible();
        const prompt = panel.getByRole('textbox', { name: '消息', exact: true });
        await prompt.fill('Continue the analysis');
        await expect(prompt).toHaveValue('Continue the analysis');
        await panel.getByRole('button', { name: '发送消息', exact: true }).click();
        await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(2);
        expect(cloud.submittedTurn(sessionId).inputConfig).toMatchObject({
          prompt: 'Continue the analysis',
          mcpServerIds: ['research-stdio'],
          inputBlocks: [{ type: 'text', text: 'Continue the analysis' }],
        });
      });
    } finally {
      const trace =
        evidence && process.env.ASSURANCE_RUN_DIRECTORY
          ? `${process.env.ASSURANCE_RUN_DIRECTORY}/packaged-capture.trace.zip`
          : testInfo.outputPath('capture.trace.zip');
      await test.step('retain the capture trace', async () => {
        await context.tracing.stop({ path: trace });
        await testInfo.attach('capture-trace', { path: trace, contentType: 'application/zip' });
      });
      if (evidence && process.env.ASSURANCE_RUN_DIRECTORY) {
        await evidence.write(
          testInfo.status === 'passed' ? 'passed' : 'failed',
          trace,
          testInfo.testId,
        );
      }
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
