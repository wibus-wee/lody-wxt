import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { chromium, expect, test } from '@playwright/test';

import { JourneyEvidence } from '../../tools/assurance/evidence';
import { RuntimeBoundary } from '../e2e/support/runtime-boundary';

test.use({ trace: 'off' });

test('new scoped draft and account survive extension and profile restarts; logout stays durable', async () => {
  test.setTimeout(120_000);
  const info = test.info();
  const evidence = new JourneyEvidence(
    'restart-extension-during-work',
    'profile-restart',
    'extension',
  );
  const directory = await mkdtemp(path.join(tmpdir(), 'lody-persistence-'));
  await promisify(execFile)('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    path.join(directory, 'key.pem'),
    '-out',
    path.join(directory, 'cert.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=backend.lody.ai',
  ]);
  const received: string[] = [];
  const cookies: Array<string | undefined> = [];
  const server = createServer(
    {
      key: await readFile(path.join(directory, 'key.pem')),
      cert: await readFile(path.join(directory, 'cert.pem')),
    },
    (request, response) => {
      received.push(request.url ?? '');
      cookies.push(request.headers.cookie);
      response.setHeader('Content-Type', 'application/json');
      const data =
        request.url === '/api/auth/device/code'
          ? {
              device_code: 'test-device',
              user_code: 'TEST',
              verification_uri: 'https://backend.lody.ai/verify',
              verification_uri_complete: 'https://backend.lody.ai/verify?code=TEST',
              expires_in: 300,
              interval: 1,
            }
          : request.url === '/api/auth/device/token'
            ? {
                access_token: 'test-persistent-token',
                expires_in: 3600,
              }
            : request.url === '/api/auth/get-session'
              ? {
                  user: { id: 'user-a', email: 'test@example.test', name: 'Persistence tester' },
                  session: {
                    id: 'session-a',
                    userId: 'user-a',
                    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
                  },
                }
              : [{ id: 'workspace-a', name: 'Persistent studio', slug: 'persistent-studio' }];
      response.end(JSON.stringify(data));
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  // ast-grep-ignore: no-typeof-operator
  if (!address || typeof address === 'string') throw new Error('missing_server_address');
  const extension = path.resolve('.output/chrome-mv3');
  const launch = () =>
    chromium.launchPersistentContext(path.join(directory, 'profile'), {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--ignore-certificate-errors',
        '--no-proxy-server',
        `--host-resolver-rules=MAP backend.lody.ai 127.0.0.1:${address.port}`,
      ],
    });
  let context = await launch();
  const cloud = new RuntimeBoundary();
  const traces: string[] = [];
  const startTrace = () =>
    context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const stopTrace = async () => {
    const name = `profile-restart-${traces.length + 1}.trace.zip`;
    const trace = process.env.ASSURANCE_RUN_DIRECTORY
      ? path.join(process.env.ASSURANCE_RUN_DIRECTORY, name)
      : info.outputPath(name);
    await context.tracing.stop({ path: trace });
    traces.push(trace);
    await info.attach(name, { path: trace, contentType: 'application/zip' });
  };
  await startTrace();
  try {
    await cloud.install(context);
    await context.addCookies([
      {
        name: 'ambient-session',
        value: 'must-not-send',
        domain: 'backend.lody.ai',
        path: '/',
        secure: true,
      },
    ]);
    const ownership: boolean[] = [];
    context.on('request', (request) => {
      if (
        request.url().includes('backend.lody.ai/api/auth/') &&
        !request.url().includes('/convex/')
      )
        ownership.push(request.serviceWorker() !== null);
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const url = `chrome-extension://${id}/options.html#/account`;
    let page = await context.newPage();
    await page.goto(url);
    await page.getByRole('button', { name: '登录 Lody', exact: true }).click();
    await expect(page.getByText('已登录：Persistence tester', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: '工作区', exact: true }).click();
    await page.getByRole('option', { name: 'Persistent studio', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '工作区', exact: true })).toContainText(
      'Persistent studio',
    );
    await evidence.check('worker-real-transport', () => {
      expect(received).toContain('/api/auth/device/code');
      expect(received).toContain('/api/auth/get-session');
      expect(ownership.length).toBeGreaterThanOrEqual(4);
      expect(ownership.every(Boolean)).toBe(true);
      expect(cookies.every((cookie) => cookie === undefined)).toBe(true);
    });
    const external = await context.newPage();
    await external.goto('https://backend.lody.ai/verify');
    const denied = await page.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & {
          chrome: {
            tabs: { query: (query: { url: string }) => Promise<{ id?: number }[]> };
            scripting: {
              executeScript: (options: {
                target: { tabId: number };
                func: () => Promise<boolean>;
              }) => Promise<{ result?: boolean }[]>;
            };
          };
        }
      ).chrome;
      const [tab] = await api.tabs.query({ url: 'https://backend.lody.ai/verify' });
      const [result] = await api.scripting.executeScript({
        target: { tabId: tab!.id! },
        func: async () => {
          try {
            const storage = (
              globalThis as typeof globalThis & {
                chrome: {
                  storage: { local: { get: (key: string) => Promise<Record<string, unknown>> } };
                };
              }
            ).chrome.storage;
            const value = await storage.local.get('accountSession');
            return value.accountSession === undefined;
          } catch {
            return true;
          }
        },
      });
      return result?.result;
    });
    await evidence.check('trusted-storage-restricted', () => expect(denied).toBe(true));
    await external.close();
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(page.getByRole('button', { name: '运行配置', exact: true })).toContainText(
      'Controlled model',
    );
    const draft = 'Unsent NEW scoped draft survives worker and browser restarts';
    await page.getByRole('textbox', { name: '消息', exact: true }).fill(draft);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.entries(localStorage).some(
            ([key, value]) =>
              key.startsWith('lody:chat-draft:') &&
              key.endsWith(':new') &&
              JSON.parse(value).text ===
                'Unsent NEW scoped draft survives worker and browser restarts',
          ),
        ),
      )
      .toBe(true);
    await info.attach('draft-restart-baseline', {
      body: 'The unsent NEW conversation draft is persisted under the account-scoped :new localStorage key. No conversation has been selected, so profile restart must retain the new draft without inventing a resume selection. No history selection is seeded or credited.',
      contentType: 'text/plain',
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const beforeReload = received.length;
    await worker
      .evaluate(() => {
        (
          globalThis as typeof globalThis & { chrome: { runtime: { reload: () => void } } }
        ).chrome.runtime.reload();
      })
      .catch(() => {});
    const settings = await context.newPage();
    await settings.goto('chrome://extensions');
    await settings.evaluate(async (extensionId) => {
      const api = (
        globalThis as typeof globalThis & {
          chrome: { management: { setEnabled: (id: string, enabled: boolean) => Promise<void> } };
        }
      ).chrome;
      await api.management.setEnabled(extensionId, true);
    }, id);
    await settings.close();
    page = await context.newPage();
    await expect(async () => {
      await page.goto(url);
      await expect(page.getByText('已登录：Persistence tester', { exact: true })).toBeVisible();
    }).toPass();
    await expect(page.getByRole('combobox', { name: '工作区', exact: true })).toContainText(
      'Persistent studio',
    );
    expect(received.slice(beforeReload)).toContain('/api/auth/get-session');
    expect(received.slice(beforeReload).some((url) => url.includes('/device/'))).toBe(false);
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(draft);
    await expect(page.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(0);
    await stopTrace();
    await context.close();
    const beforeRestart = received.length;
    context = await launch();
    await startTrace();
    await cloud.install(context);
    page = await context.newPage();
    await page.goto(url);
    await expect(page.getByText('已登录：Persistence tester', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '工作区', exact: true })).toContainText(
      'Persistent studio',
    );
    expect(received.slice(beforeRestart)).toContain('/api/auth/get-session');
    expect(received.slice(beforeRestart).some((url) => url.includes('/device/'))).toBe(false);
    await evidence.check('identity-and-draft-survive-profile-restart', async () => {
      await page.goto(`chrome-extension://${id}/sidepanel.html`);
      await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(draft);
      await expect(page.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          Object.keys(localStorage).filter((key) => key.startsWith('lody:chat-resume:')),
        ),
      ).toEqual([]);
    });
    await page.goto(url);
    await page.getByRole('button', { name: '退出此设备' }).click();
    await expect(page.getByRole('button', { name: '登录 Lody', exact: true })).toBeEnabled();
    await stopTrace();
    await context.close();
    const beforeLogoutRestart = received.length;
    context = await launch();
    await startTrace();
    await cloud.install(context);
    page = await context.newPage();
    await page.goto(url);
    await evidence.check('logout-survives-restart', async () => {
      await expect(page.getByRole('button', { name: '登录 Lody', exact: true })).toBeEnabled();
      expect(received.slice(beforeLogoutRestart)).toEqual([]);
      await page.goto(`chrome-extension://${id}/sidepanel.html`);
      await expect(page.getByText(draft, { exact: true })).toHaveCount(0);
      await expect(page.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(0);
    });
  } finally {
    await stopTrace();
    if (process.env.ASSURANCE_RUN_DIRECTORY)
      await evidence.write(info.status === 'passed' ? 'passed' : 'failed', traces[0]!, info.testId);
    await context.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
