import * as v from 'valibot';

import type { RequestOptions } from '../../shared/application/request-options.js';
import type { AuthTokenProvider, SessionSubmissionGateway } from '../application/ports.js';
import type { SessionSubmission, SubmissionReceipt } from '../domain/submission.js';
import { SubmissionError } from '../domain/submission.js';

export interface SubmissionGatewayOptions {
  convexSiteUrl: string;
  auth: AuthTokenProvider;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const receiptSchema = v.object({
  requestId: v.string(),
  turnId: v.string(),
  sessionId: v.pipe(v.string(), v.minLength(1)),
  state: v.picklist(['pending', 'submitted', 'unconfirmed']),
});
function decodeReceipt(value: unknown, requestId: string): SubmissionReceipt {
  const parsed = v.safeParse(receiptSchema, value);
  if (
    !parsed.success ||
    parsed.output.requestId !== requestId ||
    parsed.output.turnId !== requestId
  )
    throw new SubmissionError('invalid_response', 0);
  return parsed.output;
}

export class HttpSessionSubmissionGateway implements SessionSubmissionGateway {
  private readonly origin: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: SubmissionGatewayOptions) {
    const url = new URL(options.convexSiteUrl);
    if (
      url.protocol !== 'https:' ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new SubmissionError('invalid_configuration', 0);
    }
    this.origin = url.origin;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0)
      throw new SubmissionError('invalid_configuration', 0);
  }

  submit = async (
    workspaceId: string,
    input: SessionSubmission,
    options?: RequestOptions,
  ): Promise<SubmissionReceipt> => {
    const requestId = this.requestId(input.requestId);
    const body = JSON.stringify({ ...input, requestId });
    if (new TextEncoder().encode(body).length > 256 * 1024)
      throw new SubmissionError('invalid_request', 413);
    return decodeReceipt(
      await this.request(workspaceId, '', { method: 'POST', body }, options),
      requestId,
    );
  };

  lookup = async (
    workspaceId: string,
    id: string,
    options?: RequestOptions,
  ): Promise<SubmissionReceipt | null> => {
    const requestId = this.requestId(id);
    const value = await this.request(workspaceId, `/${requestId}`, { method: 'GET' }, options);
    return value === null ? null : decodeReceipt(value, requestId);
  };

  private requestId(id: string): string {
    if (!uuid.test(id)) throw new SubmissionError('invalid_request', 400);
    return id.toLowerCase();
  }

  private async request(
    workspaceId: string,
    suffix: string,
    init: RequestInit,
    options: RequestOptions = {},
  ): Promise<unknown> {
    if (!workspaceId.trim()) throw new SubmissionError('invalid_request', 400);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new SubmissionError('invalid_configuration', 0);
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const token = await this.options.auth.getToken(signal);
    signal.throwIfAborted();
    if (!token.trim()) throw new SubmissionError('not_authorized', 401);
    const response = await this.fetch.call(
      globalThis,
      `${this.origin}/api/workspaces/${encodeURIComponent(workspaceId)}/session-submissions${suffix}`,
      {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal,
      },
    );
    if (response.status === 404 && init.method === 'GET') return null;
    const value: unknown = await response.json();
    signal.throwIfAborted();
    if (!response.ok) {
      const parsed = v.safeParse(v.object({ error: v.string() }), value);
      const code = parsed.success ? parsed.output.error : 'submission_unavailable';
      throw new SubmissionError(code, response.status);
    }
    return value;
  }
}
