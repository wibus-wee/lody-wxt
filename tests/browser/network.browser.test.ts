import { createLodyClient } from '@lody-mobile/sdk';
import { expect, it, vi } from 'vitest';

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
    expect(await handler(request, sender)).toEqual({ ok: false, code: 'invalid_request' });
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
