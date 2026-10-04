import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { chromium, expect, test } from '@playwright/test';

test('packaged account SDK sends every HTTP request through its worker to an HTTPS backend without CORS headers', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lody-network-'));
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
  const received: {
    method: string;
    path: string;
    authorization: string | undefined;
    body: string;
  }[] = [];
  let polls = 0;
  const server = createServer(
    {
      key: await readFile(path.join(directory, 'key.pem')),
      cert: await readFile(path.join(directory, 'cert.pem')),
    },
    async (request, response) => {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      received.push({
        method: request.method ?? '',
        path: request.url ?? '',
        authorization: request.headers.authorization,
        body,
      });
      let data: unknown;
      switch (request.url) {
        case '/api/action':
        case '/api/mutation':
          data = { status: 'success', value: { accepted: true } };
          break;
        case '/api/auth/device/code':
          data = {
            device_code: 'controlled-device',
            user_code: 'LODY-TEST',
            verification_uri: 'https://backend.lody.ai/verify',
            verification_uri_complete: 'https://backend.lody.ai/verify?user_code=LODY-TEST',
            expires_in: 300,
            interval: 1,
          };
          break;
        case '/api/auth/device/token':
          polls += 1;
          response.statusCode = polls === 1 ? 400 : 200;
          data =
            polls === 1
              ? { error: 'authorization_pending' }
              : { access_token: 'controlled-token', token_type: 'Bearer', expires_in: 3600 };
          break;
        case '/api/auth/get-session':
          data = {
            user: { id: 'user-a', email: 'test@example.test', name: 'Worker tester' },
            session: {
              id: 'session-a',
              userId: 'user-a',
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            },
          };
          break;
        case '/api/auth/organization/list':
          data = [{ id: 'workspace-a', name: 'Worker studio', slug: 'worker-studio' }];
          break;
        default:
          response.statusCode = 404;
          data = { error: 'not_found' };
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(data));
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  // Node returns a string only for Unix sockets; this test listens on a TCP port.
  // ast-grep-ignore: no-typeof-operator
  if (!address || typeof address === 'string') throw new Error('missing_server_address');
  const extension = path.resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(path.join(directory, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--ignore-certificate-errors',
      '--no-proxy-server',
      `--host-resolver-rules=MAP backend.lody.ai 127.0.0.1:${address.port}, MAP convex.lody.ai 127.0.0.1:${address.port}`,
    ],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const ownership: boolean[] = [];
    context.on('request', (request) => {
      if (new Set(['backend.lody.ai', 'convex.lody.ai']).has(new URL(request.url()).hostname))
        ownership.push(request.serviceWorker() === worker);
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html#/account`);
    await page.getByRole('button', { name: '登录 Lody', exact: true }).click();
    await expect(page.getByText('Worker tester', { exact: false })).toBeVisible();
    expect(received.map((request) => request.path)).toEqual([
      '/api/auth/device/code',
      '/api/auth/device/token',
      '/api/auth/device/token',
      '/api/auth/get-session',
      '/api/auth/organization/list',
    ]);
    expect(received.every((request) => request.method !== 'OPTIONS')).toBe(true);
    expect(JSON.parse(received[0]!.body)).toEqual({ client_id: 'lody-cli' });
    expect(
      received.slice(3).every((request) => request.authorization === 'Bearer controlled-token'),
    ).toBe(true);
    expect(ownership).toEqual([true, true, true, true, true]);
    const operations = await page.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & {
          chrome: {
            runtime: { sendMessage: (message: Record<string, unknown>) => Promise<unknown> };
          };
        }
      ).chrome;
      const results = [];
      for (const [route, operation] of [
        ['action', 'promptShortcuts:getStreamToken'],
        ['mutation', 'promptShortcuts:stageDocument'],
      ]) {
        results.push(
          await api.runtime.sendMessage({
            type: 'network:request',
            requestId: crypto.randomUUID(),
            url: `https://convex.lody.ai/api/${route}`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              authorization: 'Bearer scoped-convex-token',
            },
            body: JSON.stringify({
              path: operation,
              args: { workspaceId: 'workspace-a' },
              format: 'json',
            }),
            credentials: 'omit',
            redirect: 'error',
            deadline: Date.now() + 15_000,
          }),
        );
      }
      return results;
    });
    expect(operations).toEqual([
      { ok: true, status: 200, data: { status: 'success', value: { accepted: true } } },
      { ok: true, status: 200, data: { status: 'success', value: { accepted: true } } },
    ]);
    expect(
      received.slice(-2).map((request) => ({
        path: request.path,
        authorization: request.authorization,
        body: JSON.parse(request.body),
      })),
    ).toEqual([
      {
        path: '/api/action',
        authorization: 'Bearer scoped-convex-token',
        body: {
          path: 'promptShortcuts:getStreamToken',
          args: { workspaceId: 'workspace-a' },
          format: 'json',
        },
      },
      {
        path: '/api/mutation',
        authorization: 'Bearer scoped-convex-token',
        body: {
          path: 'promptShortcuts:stageDocument',
          args: { workspaceId: 'workspace-a' },
          format: 'json',
        },
      },
    ]);
    expect(ownership).toEqual([true, true, true, true, true, true, true]);
    const denied = await page.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & {
          chrome: {
            runtime: {
              sendMessage: (message: {
                type: string;
                requestId: string;
                url: string;
                method: string;
                headers: Record<string, string>;
                credentials: string;
                redirect: string;
                deadline: number;
              }) => Promise<unknown>;
            };
          };
        }
      ).chrome;
      return api.runtime.sendMessage({
        type: 'network:request',
        requestId: crypto.randomUUID(),
        url: 'https://untrusted.test/api/auth/device/code',
        method: 'POST',
        headers: {},
        credentials: 'omit',
        redirect: 'error',
        deadline: Date.now() + 15_000,
      });
    });
    expect(denied).toEqual({
      ok: false,
      code: 'invalid_request',
      rejection: { stage: 'route', operation: 'unknown' },
    });
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
