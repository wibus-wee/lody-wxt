import type { HttpTransport } from '@lody-mobile/sdk';
import { LodySdkError } from '@lody-mobile/sdk';
import * as v from 'valibot';
import { browser } from 'wxt/browser';

import type { NetworkRejection } from './protocol';
import { networkLimits, networkReplySchema } from './protocol';

const rejectionMessages: Record<NetworkRejection['stage'], string> = {
  message: '扩展内部请求格式不兼容，请重新加载扩展后重试。',
  route: '扩展网络策略不支持此请求，请重新加载扩展后重试。',
  headers: '扩展拒绝了不符合规范的请求头。',
  get_body: '扩展拒绝了带有正文的读取请求。',
  request_size: '请求超过扩展允许的大小。',
  duplicate_request: '此请求正在处理，请等待后重试。',
};

function invalidWorkerRequest(rejection: NetworkRejection | undefined) {
  const error = new LodySdkError('invalid_request');
  error.message = rejection
    ? `${rejectionMessages[rejection.stage]}（${rejection.operation} / ${rejection.stage}）`
    : '扩展后台拒绝了请求，尚未提供具体原因。请重新加载扩展后重试。（invalid_request）';
  return error;
}

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
          if (reply.output.code === 'invalid_request') {
            finish(invalidWorkerRequest(reply.output.rejection));
            return;
          }
          const codes = {
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
