import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import type { Worker } from '@playwright/test';
import { chromium, expect, test } from '@playwright/test';

import type { NotificationState } from '../../src/features/notifications/model';
import { JourneyEvidence } from '../../tools/assurance/evidence';
import { AccountBoundary, signIn } from '../e2e/support/account-boundary';
import { RuntimeBoundary } from '../e2e/support/runtime-boundary';

test.use({ trace: 'off' });
type ChromeApi = {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, NotificationState>>;
      remove: (key: string) => Promise<void>;
    };
  };
  alarms: {
    create: (name: string, spec: { when: number }) => Promise<void>;
    get: (name: string) => Promise<object | undefined>;
  };
  notifications: { getAll: () => Promise<Record<string, boolean>> };
  permissions: { remove: (spec: { permissions: string[] }) => Promise<boolean> };
};
async function state(worker: Worker) {
  return worker.evaluate(
    async () =>
      (
        await (globalThis as typeof globalThis & { chrome: ChromeApi }).chrome.storage.local.get(
          'lody:notifications',
        )
      )['lody:notifications']!,
  );
}
async function wake(worker: Worker) {
  const before = (await state(worker)).checkedAt;
  await worker.evaluate(() =>
    (globalThis as typeof globalThis & { chrome: ChromeApi }).chrome.alarms.create(
      'lody:notifications:poll',
      { when: Date.now() + 100 },
    ),
  );
  await expect.poll(async () => (await state(worker)).checkedAt).toBeGreaterThan(before);
  expect((await state(worker)).error).toBeNull();
}

test('packaged notifications observe verified terminal events with the panel closed and isolate account changes', async () => {
  test.setTimeout(90_000);
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-notifications-profile-'));
  const extension = await mkdtemp(path.join(tmpdir(), 'lody-notifications-extension-'));
  await cp(path.resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifestFile = path.join(extension, 'manifest.json');
  const productionManifest = await readFile(manifestFile, 'utf8');
  const manifest = JSON.parse(productionManifest);
  expect(manifest.permissions).toContain('alarms');
  expect(manifest.optional_permissions).toContain('notifications');
  expect(manifest.incognito).toBe('not_allowed');
  manifest.permissions.push('notifications');
  manifest.optional_permissions = manifest.optional_permissions.filter(
    (permission: string) => permission !== 'notifications',
  );
  await writeFile(manifestFile, JSON.stringify(manifest));
  const launch = () =>
    chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
  const install = await launch();
  if (!install.serviceWorkers().length) await install.waitForEvent('serviceworker');
  await install.close();
  await writeFile(manifestFile, productionManifest);
  await test.info().attach('permission-baseline', {
    body: 'A temporary install grants real notification permission, then restores the production manifest before this run. Alarms are a required production permission. Browser OS permission-dialog acceptance is outside this test. No notification API or worker lifecycle function is mocked.',
    contentType: 'text/plain',
  });
  const context = await launch();
  const evidence = new JourneyEvidence(
    'observe-background-session',
    'packaged-background-observer',
    'extension',
  );
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
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
    cloud.setSessionMetadata('history-a', {
      status: { type: 'idle' },
      lastMessageAt: 1,
      latestUserMsgId: 'previous-user-turn',
    });
    await cloud.install(context);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    await signIn(panel);
    await panel.getByRole('button', { name: 'Workspace', exact: true }).click();
    // Fixture setup only: mount an existing conversation without crediting a history journey.
    await panel.evaluate(() => {
      const scope = JSON.stringify([
        JSON.stringify(['https://backend.lody.ai', 'lody-cli', 'user-a', 'workspace-a']),
        'https://convex.lody.ai',
      ]);
      sessionStorage.setItem(`lody:chat-selection:${scope}`, 'history-a');
    });
    await panel.reload();
    await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toContainText(
      'Previously asked question',
    );
    await test.info().attach('tracking-selection-baseline', {
      body: 'Per-surface sessionStorage selection is explicitly seeded as fixture setup before enabling notifications. Tracking, verified terminal observation and subsequent notification navigation use production behavior. Opening history receives no user journey credit.',
      contentType: 'text/plain',
    });
    await expect.poll(async () => (await state(worker)).tracked['history-a']).toBeGreaterThan(0);
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await panel.getByRole('switch', { name: '会话完成或需要处理时通知我', exact: true }).click();
    await evidence.check('consent-and-baseline', async () => {
      await expect
        .poll(async () => (await state(worker)).observed['history-a']?.status)
        .toBe('idle');
      expect((await state(worker)).events).toEqual([]);
      expect((await state(worker)).enabled).toBe(true);
      expect(
        await worker.evaluate(() =>
          (globalThis as typeof globalThis & { chrome: ChromeApi }).chrome.alarms.get(
            'lody:notifications:poll',
          ),
        ),
      ).toBeTruthy();
    });
    await panel.close();
    cloud.beginReply('history-a');
    cloud.setSessionMetadata('history-a', { status: { type: 'running' }, lastMessageAt: 2 });
    await wake(worker);
    cloud.setSessionMetadata('history-a', { status: { type: 'idle' }, lastMessageAt: 3 });
    await wake(worker);
    expect((await state(worker)).events).toEqual([]);
    cloud.finishReply('history-a');
    await evidence.check('closed-panel-terminal-verified', async () => {
      const observerPage = context.pages()[0] ?? (await context.newPage());
      const devtools = await context.newCDPSession(observerPage);
      let versionId = '';
      devtools.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
        const version = versions.find(
          (version) => version.scriptURL === worker.url() && version.runningStatus === 'running',
        );
        if (version) versionId = version.versionId;
      });
      await devtools.send('ServiceWorker.enable');
      await expect.poll(() => versionId).not.toBe('');
      const before = (await state(worker)).checkedAt;
      await worker.evaluate(() => {
        (
          globalThis as typeof globalThis & { notificationRestartProbe?: boolean }
        ).notificationRestartProbe = true;
      });
      await worker.evaluate(() =>
        (globalThis as typeof globalThis & { chrome: ChromeApi }).chrome.alarms.create(
          'lody:notifications:poll',
          { when: Date.now() + 1500 },
        ),
      );
      await devtools.send('ServiceWorker.stopWorker', { versionId });
      await expect
        .poll(async () => {
          try {
            return (await state(worker)).checkedAt;
          } catch {
            return 0;
          }
        })
        .toBeGreaterThan(before);
      expect(
        await worker.evaluate(
          () =>
            (globalThis as typeof globalThis & { notificationRestartProbe?: boolean })
              .notificationRestartProbe,
        ),
      ).toBeUndefined();
      expect((await state(worker)).error).toBeNull();
      await devtools.detach();
      expect(context.pages().every((page) => !page.url().includes('/sidepanel.html'))).toBe(true);
      expect((await state(worker)).events).toMatchObject([
        { sessionId: 'history-a', kind: 'completed', id: 'history-a:completed:live-answer' },
      ]);
      expect((await state(worker)).observed['history-a']?.status).toBe('idle');
      expect(
        await worker.evaluate(() =>
          (globalThis as typeof globalThis & { chrome: ChromeApi }).chrome.notifications.getAll(),
        ),
      ).toHaveProperty('lody-session:history-a:completed:live-answer');
    });
    await evidence.check('same-event-not-repeated', async () => {
      await wake(worker);
      cloud.setSessionMetadata('history-a', { lastMessageAt: 4 });
      await wake(worker);
      expect((await state(worker)).events).toHaveLength(1);
    });
    const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
    const fastPanel = await context.newPage();
    await fastPanel.goto(`${extensionOrigin}/sidepanel.html`);
    await expect(fastPanel.getByRole('button', { name: '运行配置', exact: true })).toContainText(
      'Controlled model',
    );
    await fastPanel
      .getByRole('textbox', { name: '消息', exact: true })
      .fill('Fast completion under one alarm');
    await fastPanel.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(fastPanel.getByRole('article', { name: '你的消息', exact: true })).toContainText(
      'Fast completion under one alarm',
    );
    const fastSession = [
      ...new Set(
        cloud.traffic
          .filter((item) => item.stream.startsWith('workspace-a:s:'))
          .map((item) => item.stream.slice('workspace-a:s:'.length)),
      ),
    ].find((id) => id !== 'history-a');
    expect(fastSession).toBeTruthy();
    const fastTurn = cloud.submittedTurn(fastSession!).requestId;
    await expect.poll(async () => (await state(worker)).pendingTurns[fastSession!]).toBe(fastTurn);
    await fastPanel.close();
    cloud.beginReply(fastSession!);
    cloud.finishReply(fastSession!);
    cloud.setSessionMetadata(fastSession!, {
      status: { type: 'idle' },
      lastMessageAt: Date.now(),
      latestUserMsgId: fastTurn,
    });
    await evidence.check('first-poll-fast-task-verified', async () => {
      await wake(worker);
      // checkedAt can be persisted by another session before this event is saved.
      await expect
        .poll(async () => (await state(worker)).events)
        .toEqual(
          expect.arrayContaining([
            expect.objectContaining({ sessionId: fastSession, kind: 'completed' }),
          ]),
        );
      // emit persists the event before the observer finishes clearing the pending turn.
      await expect
        .poll(async () => (await state(worker)).pendingTurns[fastSession!])
        .toBeUndefined();
    });
    const openPlaceholder = async () => {
      const created = context.waitForEvent('page');
      const tab = await worker.evaluate(() =>
        (
          globalThis as typeof globalThis & {
            chrome: {
              tabs: { create: (spec: { url: string; active: boolean }) => Promise<{ id: number }> };
            };
          }
        ).chrome.tabs.create({ url: 'about:blank', active: false }),
      );
      return { page: await created, tabId: tab.id };
    };
    const first = await openPlaceholder();
    const second = await openPlaceholder();
    const nonceA = crypto.randomUUID();
    const nonceB = crypto.randomUUID();
    const scope = (await state(worker)).scope;
    await worker.evaluate(
      async (targets) => {
        await (
          globalThis as typeof globalThis & {
            chrome: { storage: { session: { set: (data: object) => Promise<void> } } };
          }
        ).chrome.storage.session.set({ 'lody:notification-navigation': targets });
      },
      {
        [nonceA]: {
          scope,
          sessionId: 'history-a',
          tabId: first.tabId,
          expiresAt: Date.now() + 60_000,
        },
        [nonceB]: {
          scope,
          sessionId: fastSession!,
          tabId: second.tabId,
          expiresAt: Date.now() + 60_000,
        },
      },
    );
    await test.info().attach('notification-navigation-baseline', {
      body: 'Two native-click navigation records are seeded with independent nonces and actual Chrome tab IDs; the real extension runtime consumes them. OS popup clicking is outside this automation.',
      contentType: 'text/plain',
    });
    await evidence.check('navigation-bound-to-tab', async () => {
      // Resolve the second click first; it cannot consume the first click's destination.
      await second.page.goto(`${extensionOrigin}/sidepanel.html?notification=${nonceB}`);
      await expect(
        second.page.getByRole('article', { name: '你的消息', exact: true }),
      ).toContainText('Fast completion under one alarm');
      await first.page.goto(`${extensionOrigin}/sidepanel.html?notification=${nonceA}`);
      await expect(
        first.page.getByRole('article', { name: '你的消息', exact: true }).first(),
      ).toContainText('Previously asked question');
      const replay = await first.page.evaluate(
        async ({ nonce, tabId }) =>
          (
            globalThis as typeof globalThis & {
              chrome: {
                runtime: {
                  sendMessage: (message: object) => Promise<{ sessionId: string | null }>;
                };
              };
            }
          ).chrome.runtime.sendMessage({ type: 'notifications:navigate', nonce, tabId }),
        { nonce: nonceA, tabId: first.tabId },
      );
      expect(replay.sessionId).toBeNull();
    });
    await first.page.evaluate((scope) => {
      type Port = {
        postMessage: (message: object) => void;
        onDisconnect: { addListener: (listener: () => void) => void };
      };
      const globals = globalThis as typeof globalThis & {
        chrome: { runtime: { connect: (config: { name: string }) => Port } };
        staleNotificationPort?: Port;
        notificationPortDisconnected?: boolean;
      };
      const port = globals.chrome.runtime.connect({ name: 'lody:notifications:foreground' });
      globals.staleNotificationPort = port;
      port.onDisconnect.addListener(() => {
        globals.notificationPortDisconnected = true;
      });
      port.postMessage({ scope, sessionId: 'old-only-session', visible: true });
    }, scope);
    await expect
      .poll(async () => (await state(worker)).tracked['old-only-session'])
      .toBeGreaterThan(0);
    await evidence.check('permission-and-account-isolation', async () => {
      await worker.evaluate(() =>
        (globalThis as typeof globalThis & { chrome: ChromeApi }).chrome.permissions.remove({
          permissions: ['notifications'],
        }),
      );
      await expect.poll(async () => (await state(worker)).enabled).toBe(false);
      expect((await state(worker)).error).toContain('权限已关闭');
      await worker.evaluate(() =>
        (globalThis as typeof globalThis & { chrome: ChromeApi }).chrome.storage.local.remove(
          'accountSession',
        ),
      );
      await expect.poll(async () => (await state(worker)).scope).toBe('');
      expect((await state(worker)).events).toEqual([]);
      expect((await state(worker)).tracked).toEqual({});
      expect(
        await worker.evaluate(() =>
          (globalThis as typeof globalThis & { chrome: ChromeApi }).chrome.alarms.get(
            'lody:notifications:poll',
          ),
        ),
      ).toBeUndefined();
    });
    await evidence.check('stale-foreground-cannot-cross-scope', async () => {
      await expect
        .poll(() =>
          first.page.evaluate(
            () =>
              (globalThis as typeof globalThis & { notificationPortDisconnected?: boolean })
                .notificationPortDisconnected,
          ),
        )
        .toBe(true);
      await first.page.evaluate((scope) => {
        try {
          (
            globalThis as typeof globalThis & {
              staleNotificationPort?: { postMessage: (message: object) => void };
            }
          ).staleNotificationPort?.postMessage({
            scope,
            sessionId: 'old-only-session',
            visible: true,
          });
        } catch {
          /* Chrome rejects disconnected ports. */
        }
      }, scope);
      expect((await state(worker)).tracked).toEqual({});
      const rejected = await first.page.evaluate(
        async (scope) =>
          (
            globalThis as typeof globalThis & {
              chrome: {
                runtime: { sendMessage: (message: object) => Promise<{ error: string | null }> };
              };
            }
          ).chrome.runtime.sendMessage({
            type: 'notifications:submitted',
            scope,
            sessionId: 'old-only-session',
            turnId: 'late-confirmed-turn',
            expectedAccountKey: JSON.stringify([
              JSON.stringify(['https://backend.lody.ai', 'lody-cli', 'user-a', 'workspace-a']),
              'https://convex.lody.ai',
            ]),
          }),
        scope,
      );
      expect(rejected.error).toContain('账户已变化');
      expect((await state(worker)).pendingTurns).toEqual({});
    });
  } finally {
    const trace = process.env.ASSURANCE_RUN_DIRECTORY
      ? `${process.env.ASSURANCE_RUN_DIRECTORY}/notifications.trace.zip`
      : test.info().outputPath('notifications.trace.zip');
    await context.tracing.stop({ path: trace });
    await test.info().attach('notification-trace', { path: trace, contentType: 'application/zip' });
    if (process.env.ASSURANCE_RUN_DIRECTORY)
      await evidence.write(
        test.info().status === 'passed' ? 'passed' : 'failed',
        trace,
        test.info().testId,
      );
    await context.close();
    await rm(profile, { recursive: true, force: true });
    await rm(extension, { recursive: true, force: true });
  }
});
