import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import type { Worker } from '@playwright/test';
import { chromium, expect, test } from '@playwright/test';

import type { StoredSession } from '../../src/features/account/model';
import { JourneyEvidence } from '../../tools/assurance/evidence';
import { AccountBoundary } from '../e2e/support/account-boundary';
import { RuntimeBoundary } from '../e2e/support/runtime-boundary';

test.use({ trace: 'off' });

type ConnectionStatus = {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  workspaceId: string | null;
  error: string | null;
};

type ChromeApi = {
  storage: {
    local: {
      set: (values: object) => Promise<void>;
      remove: (key: string) => Promise<void>;
    };
    session: { get: (key: string) => Promise<Record<string, unknown>> };
  };
  alarms: { create: (name: string, spec: { when: number }) => Promise<void> };
};

async function status(worker: Worker) {
  return worker.evaluate(
    async () =>
      (
        await (globalThis as typeof globalThis & { chrome: ChromeApi }).chrome.storage.session.get(
          'lody:workspace:status',
        )
      )['lody:workspace:status'] as ConnectionStatus,
  );
}

/** The derived bootstrap facts a warm worker respawn reuses instead of re-asking the server. */
const cachedBootstrap = (worker: Worker) =>
  worker.evaluate(async () => {
    const stored = await (
      globalThis as typeof globalThis & { chrome: ChromeApi }
    ).chrome.storage.session.get('lody:workspace:bootstrap');
    return (stored['lody:workspace:bootstrap'] ?? null) as {
      accountId: string;
      gatewayBaseUrl: string;
      machineIds: string[];
    } | null;
  });

test('packaged workspace connects before panels, reuses its runtime and recovers after worker restart', async () => {
  test.setTimeout(90_000);
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-background-connection-'));
  const extension = path.resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const evidence = new JourneyEvidence(
    'restart-extension-during-work',
    'background-preconnect',
    'extension',
  );
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
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
    const account = new AccountBoundary();
    await account.install(context);
    const cloud = new RuntimeBoundary();
    await cloud.install(context);
    const session: StoredSession = {
      config: { authOrigin: 'https://backend.lody.ai', clientId: 'lody-cli' },
      token: { access_token: 'controlled-browser-token', token_type: 'Bearer', expires_in: 3600 },
      expiresAtMs: Date.now() + 3600_000,
      workspaceId: 'workspace-a',
    };
    const bootstrapCount = () =>
      cloud.reads.filter((stream) => stream === 'workspace-a:meta').length;
    const accountChecks = () =>
      account.requests.filter((request) => request.path === '/api/auth/get-session').length;
    const noPanel = () =>
      expect(context.pages().every((page) => !page.url().includes('/sidepanel.html'))).toBe(true);
    await test.info().attach('background-connection-baseline', {
      body: 'The real extension worker receives a previously authorized StoredSession through trusted chrome.storage.local. Only auth and Streams HTTP boundaries are controlled. No sidepanel exists until the background metadata and machine directory have connected. Worker suspension uses Chrome DevTools and recovery uses the production alarm listener.',
      contentType: 'text/plain',
    });
    await evidence.check('stored-identity-connects-without-panel', async () => {
      noPanel();
      await worker.evaluate(
        (stored) =>
          (globalThis as typeof globalThis & { chrome: ChromeApi }).chrome.storage.local.set({
            accountConfig: stored.config,
            accountSession: stored,
          }),
        session,
      );
      await expect
        .poll(() => status(worker))
        .toMatchObject({
          status: 'connected',
          workspaceId: 'workspace-a',
          error: null,
        });
      await expect.poll(bootstrapCount).toBe(1);
      await expect.poll(() => cloud.reads).toContain('workspace-a:mf:machine-a');
      expect(accountChecks()).toBeGreaterThan(0);
      expect(
        account.requests.some((request) => request.path === '/api/auth/organization/list'),
      ).toBe(true);
      // A live bootstrap seeds the cache a respawned worker reuses. It carries derived facts
      // only: no bearer grant, so it can never stand in for an authorization decision.
      const seeded = await cachedBootstrap(worker);
      expect(seeded?.accountId).not.toBe('');
      expect(seeded?.machineIds).toEqual(['machine-a']);
      expect(JSON.stringify(seeded)).not.toContain(session.token.access_token);
      noPanel();
    });
    const panel = await context.newPage();
    await panel.goto(`${origin}/sidepanel.html`);
    await expect(panel.getByRole('button', { name: '运行配置', exact: true })).toContainText(
      'Controlled model',
    );
    await panel.close();
    const probe = await context.newPage();
    await probe.goto(`${origin}/options.html#/account`);
    const readWorkerSessions = () =>
      probe.evaluate(async (stored) => {
        type Reply = {
          type: string;
          id?: string;
          value?: { id: string; title: string }[];
          error?: { message: string };
        };
        type Port = {
          postMessage: (message: object) => void;
          disconnect: () => void;
          onMessage: {
            addListener: (listener: (reply: Reply) => void) => void;
            removeListener: (listener: (reply: Reply) => void) => void;
          };
        };
        const port = (
          globalThis as typeof globalThis & {
            chrome: { runtime: { connect: (options: { name: string }) => Port } };
          }
        ).chrome.runtime.connect({ name: 'lody:workspace' });
        const call = (method: string, args: object[]) =>
          new Promise<Reply['value']>((resolve, reject) => {
            const id = crypto.randomUUID();
            const listener = (reply: Reply) => {
              if (reply.id !== id) return;
              port.onMessage.removeListener(listener);
              if (reply.type === 'error') reject(new Error(reply.error?.message));
              else resolve(reply.value);
            };
            port.onMessage.addListener(listener);
            port.postMessage({ type: 'call', id, method, args });
          });
        try {
          await call('bootstrap', [
            {
              accountId: 'user-a',
              workspaceId: 'workspace-a',
              authOrigin: stored.config.authOrigin,
              token: stored.token.access_token,
              convexUrl: 'https://convex.lody.ai',
              accountKey: JSON.stringify([
                JSON.stringify(['https://backend.lody.ai', 'lody-cli', 'user-a', 'workspace-a']),
                'https://convex.lody.ai',
              ]),
            },
          ]);
          return await call('repository.list', []);
        } finally {
          port.disconnect();
        }
      }, session);
    await test.info().attach('worker-observation-baseline', {
      body: 'An options-page probe reads the real worker repository over the production authorized workspace port. It does not mount a conversation or keep a session lease. Fixture selection later seeds only per-surface sessionStorage; opening history receives no journey credit.',
      contentType: 'text/plain',
    });
    await evidence.check('closed-panel-observes-authoritative-update', async () => {
      noPanel();
      cloud.setSessionMetadata('history-a', { title: 'Updated while the panel was closed' });
      const update = cloud.traffic.findLast(
        (item) => item.stream === 'workspace-a:meta' && item.kind === 'append',
      )!;
      await expect
        .poll(() =>
          cloud.traffic.some(
            (item) =>
              item.stream === 'workspace-a:meta' &&
              item.kind === 'sse' &&
              item.sent?.includes(update.offset),
          ),
        )
        .toBe(true);
      await expect
        .poll(
          async () => (await readWorkerSessions())?.find((row) => row.id === 'history-a')?.title,
        )
        .toBe('Updated while the panel was closed');
      noPanel();
    });
    await probe.close();
    const reopened = await context.newPage();
    const second = await context.newPage();
    await evidence.check('opening-panels-reuses-workspace-bootstrap', async () => {
      await reopened.goto(`${origin}/sidepanel.html`);
      await expect(reopened.getByRole('button', { name: '运行配置', exact: true })).toContainText(
        'Controlled model',
      );
      await second.goto(`${origin}/sidepanel.html`);
      await expect(second.getByRole('button', { name: '运行配置', exact: true })).toContainText(
        'Controlled model',
      );
      expect(bootstrapCount()).toBe(1);
    });
    await reopened.close();
    await second.close();
    await evidence.check('worker-restart-restores-without-panel', async () => {
      noPanel();
      const observer = context.pages()[0] ?? (await context.newPage());
      const devtools = await context.newCDPSession(observer);
      let versionId = '';
      devtools.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
        const version = versions.find(
          (entry) => entry.scriptURL === worker.url() && entry.runningStatus === 'running',
        );
        if (version) versionId = version.versionId;
      });
      await devtools.send('ServiceWorker.enable');
      await expect.poll(() => versionId).not.toBe('');
      const priorChecks = accountChecks();
      const priorReads = bootstrapCount();
      await worker.evaluate(async () => {
        (
          globalThis as typeof globalThis & { workspaceRestartProbe?: boolean }
        ).workspaceRestartProbe = true;
        await (globalThis as typeof globalThis & { chrome: ChromeApi }).chrome.alarms.create(
          'lody:workspace:sync',
          { when: Date.now() + 1500 },
        );
      });
      await devtools.send('ServiceWorker.stopWorker', { versionId });
      cloud.setSessionMetadata('history-a', { title: 'Updated during worker suspension' });
      const update = cloud.traffic.findLast(
        (item) => item.stream === 'workspace-a:meta' && item.kind === 'append',
      )!;
      await expect.poll(accountChecks).toBeGreaterThan(priorChecks);
      await expect
        .poll(
          () =>
            bootstrapCount() > priorReads ||
            cloud.traffic.some(
              (item) => item.stream === 'workspace-a:meta' && item.sent?.includes(update.offset),
            ),
        )
        .toBe(true);
      await expect
        .poll(() => status(worker))
        .toMatchObject({ status: 'connected', workspaceId: 'workspace-a', error: null });
      expect(
        await worker.evaluate(
          () =>
            (globalThis as typeof globalThis & { workspaceRestartProbe?: boolean })
              .workspaceRestartProbe,
        ),
      ).toBeUndefined();
      await devtools.detach();
      noPanel();
    });
    const restored = await context.newPage();
    const companion = await context.newPage();
    await restored.goto(`${origin}/sidepanel.html`);
    await companion.goto(`${origin}/sidepanel.html`);
    await expect(restored.getByRole('button', { name: '运行配置', exact: true })).toContainText(
      'Controlled model',
    );
    await expect(companion.getByRole('button', { name: '运行配置', exact: true })).toContainText(
      'Controlled model',
    );
    // Baseline selection for the active-panel restart probe; no history-opening credit.
    await restored.evaluate(() => {
      const scope = JSON.stringify([
        JSON.stringify(['https://backend.lody.ai', 'lody-cli', 'user-a', 'workspace-a']),
        'https://convex.lody.ai',
      ]);
      sessionStorage.setItem(`lody:chat-selection:${scope}`, 'history-a');
    });
    await restored.reload();
    await expect(restored.getByRole('article', { name: '你的消息', exact: true })).toContainText(
      'Previously asked question',
    );
    await evidence.check('active-panel-reconnect-resubscribes', async () => {
      const draft = 'Keep this unsent draft while the worker restarts';
      await restored.getByRole('textbox', { name: '消息', exact: true }).fill(draft);
      const devtools = await context.newCDPSession(restored);
      let versionId = '';
      devtools.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
        const version = versions.find(
          (entry) => entry.scriptURL === worker.url() && entry.runningStatus === 'running',
        );
        if (version) versionId = version.versionId;
      });
      await devtools.send('ServiceWorker.enable');
      await expect.poll(() => versionId).not.toBe('');
      const priorChecks = accountChecks();
      await worker.evaluate(() => {
        (
          globalThis as typeof globalThis & { activeWorkspaceRestartProbe?: boolean }
        ).activeWorkspaceRestartProbe = true;
      });
      await devtools.send('ServiceWorker.stopWorker', { versionId });
      await expect.poll(accountChecks).toBeGreaterThan(priorChecks);
      await expect
        .poll(() => status(worker))
        .toMatchObject({ status: 'connected', workspaceId: 'workspace-a', error: null });
      expect(
        await worker.evaluate(
          () =>
            (globalThis as typeof globalThis & { activeWorkspaceRestartProbe?: boolean })
              .activeWorkspaceRestartProbe,
        ),
      ).toBeUndefined();
      cloud.beginReply('history-a');
      cloud.finishReply('history-a');
      const update = cloud.traffic.findLast(
        (item) => item.stream === 'workspace-a:s:history-a' && item.kind === 'append',
      )!;
      // The HTTP fixture closes each SSE response; allow the SDK's reconnect interval.
      await expect
        .poll(
          () =>
            cloud.traffic.some(
              (item) =>
                item.stream === 'workspace-a:s:history-a' && item.sent?.includes(update.offset),
            ),
          { timeout: 10_000 },
        )
        .toBe(true);
      await expect(
        restored.getByText('网页分析完成：这是一个协作项目。', { exact: true }),
      ).toBeVisible();
      await expect(restored.getByRole('article', { name: '你的消息', exact: true })).toContainText(
        'Previously asked question',
      );
      await expect(restored.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(draft);
      await expect(restored.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
      await devtools.detach();
    });
    await evidence.check('logout-revokes-all-leases-and-old-data', async () => {
      await worker.evaluate(() =>
        (globalThis as typeof globalThis & { chrome: ChromeApi }).chrome.storage.local.remove(
          'accountSession',
        ),
      );
      await expect
        .poll(() => status(worker))
        .toMatchObject({ status: 'disconnected', workspaceId: null });
      // Derived bootstrap facts are scoped to the credential that produced them, and signing
      // out drops them rather than leaving a signed-out profile holding workspace metadata.
      await expect.poll(() => cachedBootstrap(worker)).toBeNull();
      cloud.setSessionMetadata('history-a', { title: 'Old account update after logout' });
      for (const surface of [restored, companion]) {
        await expect(surface.getByRole('button', { name: '登录 Lody', exact: true })).toBeVisible();
        await expect(surface.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(
          0,
        );
        await expect(
          surface.getByText('Old account update after logout', { exact: true }),
        ).toHaveCount(0);
      }
      await restored.reload();
      await expect(restored.getByRole('button', { name: '登录 Lody', exact: true })).toBeVisible();
      expect((await status(worker))?.status).toBe('disconnected');
    });
  } finally {
    const trace = process.env.ASSURANCE_RUN_DIRECTORY
      ? `${process.env.ASSURANCE_RUN_DIRECTORY}/background-connection.trace.zip`
      : test.info().outputPath('background-connection.trace.zip');
    await context.tracing.stop({ path: trace });
    await test
      .info()
      .attach('background-connection-trace', { path: trace, contentType: 'application/zip' });
    if (process.env.ASSURANCE_RUN_DIRECTORY)
      await evidence.write(
        test.info().status === 'passed' ? 'passed' : 'failed',
        trace,
        test.info().testId,
      );
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
