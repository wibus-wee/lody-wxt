import type { StreamsAuthProvider } from '@loro-dev/streams-client';
import { StreamsClient } from '@loro-dev/streams-client';
import * as v from 'valibot';

import type { JsonRpcStreamsPort, RpcFailure, RpcPayload } from './streams-machine-commands.js';

const trailingSlash = /\/+$/;

export class JsonRpcStreams implements JsonRpcStreamsPort {
  constructor(
    private readonly options: {
      baseUrl: string;
      auth: StreamsAuthProvider;
      fetch?: typeof globalThis.fetch;
    },
  ) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== 'https:') throw new Error('invalid_configuration');
  }

  private client(streamId: string) {
    return new StreamsClient({
      url: `${this.options.baseUrl.replace(trailingSlash, '')}/ds/lody/${encodeURIComponent(streamId)}`,
      auth: this.options.auth,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
  }

  ensure = async (streamId: string) => {
    const client = this.client(streamId);
    const created = await client.create({ contentType: 'application/json', ttlSeconds: 86400 });
    if (created.ok) return;
    if (created.result.code !== 'conflict') throw new Error(created.result.code);
    const head = await client.head();
    if (!head.ok) throw new Error(head.result.code);
    if (
      head.result.closed ||
      head.result.contentType !== 'application/json' ||
      head.result.ttlSeconds !== 86400
    )
      throw new Error('incompatible_rpc_stream');
  };

  append = async (streamId: string, value: RpcPayload) => {
    const result = await this.client(streamId).append({
      part: { contentType: 'application/json', body: JSON.stringify(value) },
    });
    if (!result.ok) throw new Error(result.result.code);
  };

  subscribe = async (
    streamId: string,
    listener: (value: RpcPayload) => void,
    signal: AbortSignal,
    onError?: RpcFailure,
  ) => {
    const client = this.client(streamId);
    let ready: () => void = () => {};
    let fail: RpcFailure = () => {};
    const readiness = new Promise<void>((resolve, reject) => {
      ready = resolve;
      fail = reject;
    });
    const loop = async () => {
      let offset = 'now';
      while (!signal.aborted) {
        for await (const event of client.live({ offset, mode: 'sse', signal })) {
          if (event.type === 'error') {
            throw new Error(event.error.code);
          } else if (event.type === 'data') {
            offset = event.nextOffset;
            const values = v.parse(
              v.array(v.record(v.string(), v.unknown())),
              event.payload.json(),
            );
            values.forEach(listener);
          } else if (event.type === 'up_to_date') {
            offset = event.nextOffset;
            ready();
          }
        }
      }
    };
    const abort = () => fail(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void loop()
      .catch((error) => {
        fail(error);
        onError?.(error);
      })
      .finally(() => signal.removeEventListener('abort', abort));
    return readiness;
  };
}
