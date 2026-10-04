import {
  BetterAuthConvexJwtProvider,
  ConvexPromptShortcuts,
  createLodyClient,
} from '@lody-mobile/sdk';
import { expect, it, vi } from 'vitest';

import { createWorkerFetch } from '../../src/features/connection/worker-fetch';
import { createNetworkHandler } from '../../src/features/network/background';
import { networkLimits } from '../../src/features/network/protocol';
import { extensionHttpTransport } from '../../src/features/network/transport';

const { sendMessage } = vi.hoisted(() => ({
  sendMessage: vi.fn<(message: { type: string; requestId: string }) => Promise<unknown>>(),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { id: 'extension-id', getURL: () => 'chrome-extension://extension-id/', sendMessage },
  },
}));

it('preserves safe worker failures through the SDK device flow', async () => {
  const client = createLodyClient({
    authOrigin: 'https://backend.lody.ai',
    clientId: 'lody-cli',
    transport: extensionHttpTransport,
  });
  for (const [workerCode, sdkCode] of [
    ['forbidden', 'forbidden'],
    ['invalid_request', 'invalid_request'],
    ['timeout', 'timeout'],
    ['cancelled', 'cancelled'],
    ['invalid_json', 'invalid_response'],
    ['response_too_large', 'invalid_response'],
    ['network_error', 'network_error'],
  ]) {
    sendMessage.mockResolvedValue({ ok: false, code: workerCode });
    await expect(client.identity.requestDeviceCode()).rejects.toMatchObject({
      name: 'LodySdkError',
      code: sdkCode,
    });
  }
  sendMessage.mockResolvedValue(undefined);
  await expect(client.identity.requestDeviceCode()).rejects.toMatchObject({
    code: 'invalid_response',
  });
});

const sender = {
  id: 'extension-id',
  url: 'chrome-extension://extension-id/options.html',
  origin: 'chrome-extension://extension-id',
};
const message = () => ({
  type: 'network:request',
  requestId: crypto.randomUUID(),
  url: 'https://backend.lody.ai/api/auth/device/code',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
  credentials: 'omit',
  redirect: 'error',
  deadline: Date.now() + 15_000,
});

it('rejects content scripts, external callers, arbitrary paths and extra message fields before fetch', async () => {
  const fetchRequest = vi.fn<typeof fetch>();
  const handler = createNetworkHandler(fetchRequest);
  for (const caller of [
    { ...sender, id: 'other' },
    { ...sender, url: 'https://example.test/', origin: 'https://example.test' },
  ]) {
    expect(await handler(message(), caller)).toEqual({ ok: false, code: 'forbidden' });
  }
  for (const request of [
    { ...message(), url: 'https://backend.lody.ai/api/unknown' },
    { ...message(), credentials: 'include' },
    { ...message(), unexpected: true },
  ]) {
    expect(await handler(request, sender)).toMatchObject({ ok: false, code: 'invalid_request' });
  }
  expect(fetchRequest).not.toHaveBeenCalled();
});

it('cancels the matching request and releases its ID for a subsequent request', async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetchRequest = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(async (_url, options) => {
      started();
      return new Promise<Response>((_resolve, reject) =>
        options?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true },
        ),
      );
    })
    .mockResolvedValue(new Response('{"error":"authorization_pending"}', { status: 400 }));
  const handler = createNetworkHandler(fetchRequest);
  const request = message();
  const pending = handler(request, sender);
  await ready;
  expect(await handler(request, sender)).toEqual({
    ok: false,
    code: 'invalid_request',
    rejection: { stage: 'duplicate_request', operation: 'device_code' },
  });
  await handler({ type: 'network:cancel', requestId: request.requestId }, sender);
  expect(await pending).toEqual({ ok: false, code: 'cancelled' });
  expect(await handler(request, sender)).toEqual({
    ok: true,
    status: 400,
    data: { error: 'authorization_pending' },
  });
});

it('bounds streamed response bytes and rejects elapsed deadlines', async () => {
  const fetchRequest = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(new Uint8Array(networkLimits.maxResponseBytes + 1)));
  const handler = createNetworkHandler(fetchRequest);
  expect(await handler(message(), sender)).toEqual({ ok: false, code: 'response_too_large' });
  expect(await handler({ ...message(), deadline: Date.now() - 1 }, sender)).toEqual({
    ok: false,
    code: 'timeout',
  });
  expect(fetchRequest).toHaveBeenCalledTimes(1);
});

it('settles page cancellation and deadline even when the worker never replies', async () => {
  sendMessage.mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const request = {
    method: 'POST' as const,
    headers: {},
    credentials: 'omit' as const,
    redirect: 'error' as const,
    signal: controller.signal,
  };
  const cancelled = extensionHttpTransport('https://backend.lody.ai/api/auth/device/code', request);
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'LodySdkError', code: 'cancelled' });
  expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'network:cancel' }));
  vi.useFakeTimers();
  try {
    const pending = extensionHttpTransport('https://backend.lody.ai/api/auth/device/code', {
      ...request,
      signal: new AbortController().signal,
    });
    const rejection = expect(pending).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(networkLimits.timeoutMs);
    await rejection;
    expect(sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'network:cancel' }),
    );
  } finally {
    vi.useRealTimers();
  }
});

it('forwards scoped Convex actions and mutations but rejects other hosts, paths and methods', async () => {
  const fetchRequest = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response('{"status":"success","value":null}'));
  const handler = createNetworkHandler(fetchRequest);
  for (const route of ['action', 'mutation']) {
    const request = {
      ...message(),
      url: `https://convex.lody.ai/api/${route}`,
      headers: { authorization: 'Bearer scoped-token' },
      body: JSON.stringify({
        path: 'promptShortcuts:stageDocument',
        args: { workspaceId: 'workspace-a' },
      }),
    };
    expect(await handler(request, sender)).toMatchObject({ ok: true, status: 200 });
    expect(fetchRequest).toHaveBeenLastCalledWith(
      request.url,
      expect.objectContaining({
        body: request.body,
        headers: request.headers,
        credentials: 'omit',
        redirect: 'error',
      }),
    );
  }
  for (const request of [
    { ...message(), url: 'https://evil.test/api/action' },
    { ...message(), url: 'https://convex.lody.ai/api/admin' },
    { ...message(), url: 'https://convex.lody.ai/api/mutation', method: 'GET', body: undefined },
  ])
    expect(await handler(request, sender)).toMatchObject({ ok: false, code: 'invalid_request' });
  expect(fetchRequest).toHaveBeenCalledTimes(2);
});

it('classifies worker rejection without returning any request content or credentials', async () => {
  const fetchRequest = vi.fn<typeof fetch>();
  const handler = createNetworkHandler(fetchRequest);
  for (const [request, stage, operation] of [
    [{ ...message(), unexpected: 'private-input' }, 'message', 'unknown'],
    [
      {
        ...message(),
        url: 'https://convex.lody.ai/api/query?secret=private-input',
        body: JSON.stringify({
          path: 'promptShortcuts:listAccessibleDocuments',
          args: { private: 'private-input' },
        }),
      },
      'route',
      'shortcut_directory',
    ],
    [
      {
        ...message(),
        headers: { authorization: 'Bearer private-input', 'x-secret': 'private-input' },
      },
      'headers',
      'device_code',
    ],
    [
      { ...message(), url: 'https://backend.lody.ai/api/auth/convex/token', method: 'GET' },
      'get_body',
      'cloud_auth',
    ],
    [
      { ...message(), body: 'a'.repeat(networkLimits.maxRequestBytes + 1) },
      'request_size',
      'device_code',
    ],
  ] as const) {
    const result = await handler(request, sender);
    expect(result).toEqual({ ok: false, code: 'invalid_request', rejection: { stage, operation } });
    expect(JSON.stringify(result)).not.toContain('private-input');
    expect(JSON.stringify(result)).not.toContain('Bearer');
  }
  expect(fetchRequest).not.toHaveBeenCalled();
});

it('explains current and legacy worker rejections while preserving the SDK error code', async () => {
  const fetch = createWorkerFetch(extensionHttpTransport);
  const request = () =>
    fetch('https://convex.lody.ai/api/query', { method: 'POST', body: '{}', credentials: 'omit' });
  sendMessage.mockResolvedValue({
    ok: false,
    code: 'invalid_request',
    rejection: { stage: 'route', operation: 'shortcut_directory' },
  });
  await expect(request()).rejects.toMatchObject({
    code: 'invalid_request',
    message: expect.stringContaining('shortcut_directory / route'),
  });
  sendMessage.mockResolvedValue({ ok: false, code: 'invalid_request' });
  await expect(request()).rejects.toMatchObject({
    code: 'invalid_request',
    message: expect.stringContaining('请重新加载扩展'),
  });
  sendMessage.mockResolvedValue({
    ok: false,
    code: 'invalid_request',
    rejection: { stage: 'route', operation: 'secret-token' },
  });
  await expect(request()).rejects.toMatchObject({ code: 'invalid_response' });
});

it('retains only bounded worker diagnostics when the SDK sanitizes a Streams error', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const fetchRequest = vi.fn<typeof fetch>();
  const handler = createNetworkHandler(fetchRequest);
  sendMessage.mockImplementation(async (message) =>
    handler(
      {
        ...JSON.parse(JSON.stringify(message)),
        headers: { 'x-disallowed': 'private-header-value' },
      },
      sender,
    ),
  );
  const client = createLodyClient({
    authOrigin: 'https://backend.lody.ai',
    clientId: 'lody-cli',
    transport: extensionHttpTransport,
  });
  try {
    await expect(
      client.streams.getGrant('private-token', 'private-workspace'),
    ).rejects.toMatchObject({
      code: 'invalid_request',
      message: 'Lody SDK: invalid_request',
    });
    expect(warning.mock.calls).toEqual([
      ['Lody network request rejected', { stage: 'headers', operation: 'streams_grant' }],
    ]);
    expect(fetchRequest).not.toHaveBeenCalled();
  } finally {
    warning.mockRestore();
  }
});

it('admits real shortcut SDK JWT and directory requests across Chrome JSON serialization and the worker policy', async () => {
  const received: Array<{ url: string; method: string | undefined }> = [];
  const handler = createNetworkHandler(async (url, init) => {
    received.push({ url: String(url), method: init?.method });
    return Response.json(
      String(url).endsWith('/api/auth/convex/token')
        ? { token: 'header.payload.signature' }
        : { status: 'success', value: [] },
    );
  });
  sendMessage.mockImplementation(async (message) =>
    handler(JSON.parse(JSON.stringify(message)), sender),
  );
  const fetch = createWorkerFetch(extensionHttpTransport);
  const jwt = new BetterAuthConvexJwtProvider({
    authOrigin: 'https://backend.lody.ai',
    getSessionBearer: async () => 'credential',
    fetch,
  });
  const shortcuts = new ConvexPromptShortcuts({
    origin: 'https://convex.lody.ai',
    workspaceId: 'workspace',
    userId: 'user',
    getJwt: (signal) => jwt.getJwt(signal),
    fetch,
  });
  expect(await shortcuts.listAccessibleDocuments()).toEqual([]);
  expect(received).toEqual([
    { url: 'https://backend.lody.ai/api/auth/convex/token', method: 'GET' },
    { url: 'https://convex.lody.ai/api/query', method: 'POST' },
  ]);
});
