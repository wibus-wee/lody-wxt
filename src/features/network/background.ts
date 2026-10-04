import * as v from 'valibot';
import { browser } from 'wxt/browser';

import type { NetworkRejection, NetworkReply } from './protocol';
import { allowedRequest, networkLimits, networkMessageSchema, networkOperation } from './protocol';

const headerNewline = /[\r\n]/;

type Sender = { id?: string; url?: string; origin?: string; tab?: unknown };

function rejectRequest(rejection: NetworkRejection): Promise<NetworkReply> {
  console.warn('Lody network request rejected', rejection);
  return Promise.resolve({ ok: false, code: 'invalid_request', rejection });
}

export function createNetworkHandler(
  fetchRequest: typeof fetch = (...args) => globalThis.fetch(...args),
) {
  const active = new Map<string, AbortController>();
  return (message: unknown, sender: Sender): Promise<NetworkReply> | undefined => {
    const envelope = v.safeParse(
      v.looseObject({ type: v.picklist(['network:request', 'network:cancel']) }),
      message,
    );
    if (!envelope.success) return undefined;
    const prefix = browser.runtime.getURL('');
    if (
      sender.id !== browser.runtime.id ||
      !sender.url?.startsWith(prefix) ||
      (sender.origin !== undefined && `${sender.origin}/` !== prefix)
    )
      return Promise.resolve({ ok: false, code: 'forbidden' });
    const parsed = v.safeParse(networkMessageSchema, message);
    if (!parsed.success) return rejectRequest({ stage: 'message', operation: 'unknown' });
    const request = parsed.output;
    const key = `${sender.url}:${request.requestId}`;
    if (request.type === 'network:cancel') {
      active.get(key)?.abort();
      return Promise.resolve({ ok: false, code: 'cancelled' });
    }
    const headers = Object.entries(request.headers);
    const reject = (stage: NetworkRejection['stage']): Promise<NetworkReply> =>
      rejectRequest({
        stage,
        operation: networkOperation(
          request.url,
          stage === 'request_size' ? undefined : request.body,
        ),
      });
    if (!allowedRequest(request.url, request.method)) return reject('route');
    if (
      headers.length > 8 ||
      headers.some(
        ([name, value]) =>
          !['accept', 'content-type', 'authorization'].includes(name.toLowerCase()) ||
          value.length > 8192 ||
          headerNewline.test(value),
      )
    )
      return reject('headers');
    if (request.method === 'GET' && request.body !== undefined) return reject('get_body');
    if (new TextEncoder().encode(request.body ?? '').byteLength > networkLimits.maxRequestBytes)
      return reject('request_size');
    if (active.has(key)) return reject('duplicate_request');
    const remaining = Math.min(networkLimits.timeoutMs, request.deadline - Date.now());
    if (remaining <= 0) return Promise.resolve({ ok: false, code: 'timeout' });
    const controller = new AbortController();
    active.set(key, controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, remaining);
    return (async (): Promise<NetworkReply> => {
      try {
        const response = await fetchRequest(request.url, {
          method: request.method,
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: request.body }),
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
        });
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) {
          try {
            let result = await reader.read();
            while (!result.done) {
              const value = result.value;
              size += value.byteLength;
              if (size > networkLimits.maxResponseBytes) {
                controller.abort();
                await reader.cancel().catch(() => {});
                return { ok: false, code: 'response_too_large' };
              }
              chunks.push(value);
              result = await reader.read();
            }
          } finally {
            reader.releaseLock();
          }
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        try {
          return {
            ok: true,
            status: response.status,
            data: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
          };
        } catch {
          return { ok: false, code: 'invalid_json' };
        }
      } catch {
        return {
          ok: false,
          code: timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'network_error',
        };
      } finally {
        clearTimeout(timer);
        active.delete(key);
      }
    })();
  };
}
