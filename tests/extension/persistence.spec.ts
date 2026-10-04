import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { chromium, expect, test } from '@playwright/test';

test('credentials survive extension reload and profile restart, stay restricted, and logout persists', async () => {
  test.setTimeout(90_000);
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
  const server = createServer(
    {
      key: await readFile(path.join(directory, 'key.pem')),
      cert: await readFile(path.join(directory, 'cert.pem')),
    },
    (request, response) => {
      received.push(request.url ?? '');
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
  try {
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
    expect(denied).toBe(true);
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
    await context.close();
    const beforeRestart = received.length;
    context = await launch();
    page = await context.newPage();
    await page.goto(url);
    await expect(page.getByText('已登录：Persistence tester', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '工作区', exact: true })).toContainText(
      'Persistent studio',
    );
    expect(received.slice(beforeRestart)).toContain('/api/auth/get-session');
    expect(received.slice(beforeRestart).some((url) => url.includes('/device/'))).toBe(false);
    await page.getByRole('button', { name: '退出此设备' }).click();
    await expect(page.getByRole('button', { name: '登录 Lody', exact: true })).toBeEnabled();
    await context.close();
    const beforeLogoutRestart = received.length;
    context = await launch();
    page = await context.newPage();
    await page.goto(url);
    await expect(page.getByRole('button', { name: '登录 Lody', exact: true })).toBeEnabled();
    expect(received.slice(beforeLogoutRestart)).toEqual([]);
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
