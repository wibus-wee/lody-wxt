import type { HttpTransport } from '@lody-mobile/sdk';
import { LodySdkError } from '@lody-mobile/sdk';
import * as v from 'valibot';
import { browser } from 'wxt/browser';

import { networkLimits, networkReplySchema } from './protocol';

export const extensionHttpTransport: HttpTransport = (url, request) =>
  new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    function abort() {
      cancelWorker();
      finish(new LodySdkError('cancelled'));
    }
    function cancelWorker() {
      void browser.runtime.sendMessage({ type: 'network:cancel', requestId }).catch(() => {});
    }
    function finish(error?: Error, response?: { status: number; json: () => Promise<unknown> }) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else if (response) resolve(response);
    }
    timer = setTimeout(() => {
      cancelWorker();
      finish(new LodySdkError('timeout'));
    }, networkLimits.timeoutMs);
    if (request.signal.aborted) {
      abort();
      return;
    }
    request.signal.addEventListener('abort', abort, { once: true });
    void browser.runtime
      .sendMessage({
        type: 'network:request',
        requestId,
        url,
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        credentials: request.credentials,
        redirect: request.redirect,
        deadline: Date.now() + networkLimits.timeoutMs,
      })
      .then((value: unknown) => {
        const reply = v.safeParse(networkReplySchema, value);
        if (!reply.success) {
          finish(new LodySdkError('invalid_response'));
          return;
        }
        if (!reply.output.ok) {
          const codes = {
            invalid_request: 'invalid_request',
            forbidden: 'forbidden',
            cancelled: 'cancelled',
            timeout: 'timeout',
            response_too_large: 'invalid_response',
            invalid_json: 'invalid_response',
            network_error: 'network_error',
          } as const;
          finish(new LodySdkError(codes[reply.output.code]));
          return;
        }
        const { status, data } = reply.output;
        finish(undefined, { status, json: () => Promise.resolve(data) });
      })
      .catch(() => finish(new LodySdkError('network_error')));
  });
