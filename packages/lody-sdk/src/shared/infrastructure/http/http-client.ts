import { createFetch } from 'ofetch';

import type { Clock } from '../../application/clock.js';
import type { RequestOptions } from '../../application/request-options.js';
import type { SdkErrorCode } from '../../domain/errors.js';
import { LodySdkError } from '../../domain/errors.js';
import { milliseconds } from '../../domain/values.js';
import type { HttpResponse, HttpTransport } from './transport.js';

export interface HttpClientOptions {
  origin: string;
  clock: Clock;
  transport?: HttpTransport;
  requestTimeoutMs: number;
}

export function createHttpClient(options: HttpClientOptions) {
  const { origin, clock } = options;
  const defaultTimeout = options.requestTimeoutMs;
  // The injected clock owns the whole request deadline, including body decoding.
  const transport: HttpTransport =
    options.transport ??
    ((url, request) => {
      const http = createFetch({ fetch: (...args) => globalThis.fetch(...args) });
      return http.raw(url, {
        ...request,
        retry: 0,
        ignoreResponseError: true,
        responseType: 'stream',
      });
    });
  async function request(
    path: string,
    // Endpoint gateways own payload schemas; this transport only serializes their JSON bodies.
    // ast-grep-ignore: no-unknown-parameter
    body: unknown,
    credential: string | undefined,
    config: RequestOptions,
    deviceEndpoint = false,
    deadline?: number,
  ): Promise<{ status: number; data: unknown }> {
    if (config.signal?.aborted) throw new LodySdkError('cancelled');
    const configuredTimeout = milliseconds(config.timeoutMs ?? defaultTimeout, 'invalid_argument');
    const remaining = deadline === undefined ? Infinity : deadline - clock.now();
    if (remaining <= 0) throw new LodySdkError('expired_token');
    const timeout = Math.min(configuredTimeout, remaining);
    const controller = new AbortController();
    const timerController = new AbortController();
    let failure: LodySdkError | undefined;
    let rejectAbort!: (error: LodySdkError) => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const stop = (code: SdkErrorCode) => {
      if (failure) return;
      failure = new LodySdkError(code);
      rejectAbort(failure);
      controller.abort();
    };
    const cancel = () => stop('cancelled');
    config.signal?.addEventListener('abort', cancel, { once: true });
    const timer = clock.sleep(timeout, timerController.signal).then(
      () => {
        stop(remaining <= configuredTimeout ? 'expired_token' : 'timeout');
      },
      () => {
        if (!timerController.signal.aborted) stop('network_error');
      },
    );
    const operation = async () => {
      let response: HttpResponse;
      try {
        response = await transport(`${origin}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(credential === undefined ? {} : { Authorization: `Bearer ${credential}` }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
        });
      } catch (error) {
        throw (
          failure ??
          (error instanceof LodySdkError
            ? new LodySdkError(error.code, error.status)
            : new LodySdkError('network_error'))
        );
      }
      if (failure) throw failure;
      if (
        !response ||
        !Number.isInteger(response.status) ||
        response.status < 100 ||
        response.status > 599
      ) {
        throw new LodySdkError('invalid_response');
      }
      if (response.status === 401) throw new LodySdkError('unauthenticated', 401);
      if (response.status === 403) throw new LodySdkError('forbidden', 403);
      const success = response.status >= 200 && response.status < 300;
      // Better Auth represents device pending/denial as HTTP 400; other failure statuses never authorize.
      if (!success && !(deviceEndpoint && response.status === 400))
        throw new LodySdkError('http_error', response.status);
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw failure ?? new LodySdkError('invalid_response', response.status);
      }
      if (failure) throw failure;
      if (deadline !== undefined && clock.now() >= deadline)
        throw new LodySdkError('expired_token');
      return { status: response.status, data };
    };
    try {
      return await Promise.race([operation(), aborted]);
    } finally {
      config.signal?.removeEventListener('abort', cancel);
      timerController.abort();
      await timer;
    }
  }

  return { request };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
