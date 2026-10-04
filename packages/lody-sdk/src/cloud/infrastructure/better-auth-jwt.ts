import * as v from 'valibot';

import type { ConvexJwtProvider } from '../application/ports.js';
import { CloudError } from '../domain/models.js';

const tokenSchema = v.object({ token: v.pipe(v.string(), v.regex(/^[\w-]+\.[\w-]+\.[\w-]+$/)) });

export class BetterAuthConvexJwtProvider implements ConvexJwtProvider {
  private readonly origin: string;
  constructor(
    private readonly options: {
      authOrigin: string;
      getSessionBearer: (signal?: AbortSignal) => Promise<string>;
      fetch?: typeof globalThis.fetch;
      timeoutMs?: number;
    },
  ) {
    const url = new URL(options.authOrigin);
    if (
      url.protocol !== 'https:' ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new CloudError('invalid_configuration', 0);
    this.origin = url.origin;
  }

  getJwt = async (callerSignal?: AbortSignal): Promise<string> => {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 15_000);
    const signal = callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout;
    signal.throwIfAborted();
    const bearer = v.parse(
      v.pipe(v.string(), v.minLength(1)),
      await this.options.getSessionBearer(signal),
    );
    signal.throwIfAborted();
    const response = await (this.options.fetch ?? globalThis.fetch)(
      `${this.origin}/api/auth/convex/token`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${bearer}` },
        credentials: 'omit',
        cache: 'no-store',
        signal,
      },
    );
    if (!response.ok) throw new CloudError('jwt_exchange_failed', response.status);
    const result = v.parse(tokenSchema, await response.json());
    signal.throwIfAborted();
    return result.token;
  };
}
