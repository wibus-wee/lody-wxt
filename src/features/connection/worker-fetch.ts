import type { HttpTransport } from '@lody-mobile/sdk';
import * as v from 'valibot';

import { extensionHttpTransport } from '../network/transport';

export function createWorkerFetch(transport: HttpTransport): typeof globalThis.fetch {
  return async (input, init = {}) => {
    const url = v.parse(v.string(), input);
    const method = v.parse(v.picklist(['GET', 'POST']), init.method ?? 'GET');
    const body = v.parse(v.optional(v.string()), init.body ?? undefined);
    if (body !== undefined) JSON.parse(body);
    if (init.credentials !== 'omit')
      throw new Error('Worker JSON requests require credentials:omit.');
    const signal = init.signal ?? new AbortController().signal;
    signal.throwIfAborted();
    const response = await transport(url, {
      method,
      headers: Object.fromEntries(new Headers(init.headers)),
      ...(body === undefined ? {} : { body }),
      credentials: 'omit',
      redirect: 'error',
      signal,
    });
    signal.throwIfAborted();
    const data = await response.json();
    signal.throwIfAborted();
    return new Response(
      new Set([204, 205, 304]).has(response.status) ? null : JSON.stringify(data),
      { status: response.status, headers: { 'Content-Type': 'application/json' } },
    );
  };
}
export function cloudFetch(protocol = location.protocol): typeof globalThis.fetch {
  return new Set(['chrome-extension:', 'moz-extension:']).has(protocol)
    ? createWorkerFetch(extensionHttpTransport)
    : globalThis.fetch.bind(globalThis);
}
