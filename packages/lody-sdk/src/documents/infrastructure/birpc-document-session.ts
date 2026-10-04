import type { BirpcReturn } from 'birpc';
import { createBirpc } from 'birpc';
import * as v from 'valibot';

import type { Clock } from '../../shared/application/clock.js';
import { systemClock } from '../../shared/infrastructure/system-clock.js';
import type { DataEnvironment, DataMethods, DocumentSession } from '../application/ports.js';
import type { DataChange } from '../domain/models.js';
import type { DataHost } from './host.js';
import { parseChange, parseEnvironment, parseRequest, validateResult } from './schemas.js';
import { DATA_PROTOCOL, parseMessage, record, stringifyMessage } from './wire.js';

export interface DataRuntimeOptions {
  clock?: Clock;
  initializationTimeoutMs?: number;
}

let generation = 0;

export class BirpcDocumentSession implements DocumentSession {
  readonly instanceId = `offline-${++generation}`;
  readonly ready: Promise<DataEnvironment>;
  readonly data: DataMethods;
  private readonly rpc: BirpcReturn<DataMethods>;
  // birpc owns decoding after the envelope and reply ID have been validated here.
  // ast-grep-ignore: no-unknown-parameter
  private receiveRpc!: (message: unknown) => void;
  private readonly cancellations = new Set<(error: Error) => void>();
  private readonly changeListeners = new Set<(change: DataChange) => void>();
  private readonly closeListeners = new Set<() => void>();
  private initialized = false;
  private settleReady!: (environment?: DataEnvironment, error?: Error) => void;
  get closed(): boolean {
    return this.rpc.$closed;
  }
  get available(): boolean {
    return this.initialized && !this.closed;
  }

  constructor(
    private readonly host: DataHost,
    options: DataRuntimeOptions = {},
  ) {
    const timeout = options.initializationTimeoutMs ?? 15_000;
    const deadline = new AbortController();
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('invalid_input');
    this.ready = new Promise((resolve, reject) => {
      this.settleReady = (environment, error) => {
        deadline.abort();
        if (error) reject(error);
        else resolve(environment!);
      };
    });
    void this.ready.catch(() => {});
    this.rpc = createBirpc<DataMethods>(
      {},
      {
        on: (receive) => {
          this.receiveRpc = receive;
        },
        off: () => {
          this.receiveRpc = () => {};
        },
        post: (rpc) => {
          try {
            host.send(
              stringifyMessage({
                protocol: DATA_PROTOCOL,
                instanceId: this.instanceId,
                type: 'rpc',
                rpc,
              }),
            );
          } catch {
            this.close(new Error('host_failed'));
          }
        },
        onRequest: async (request, next) => {
          if (!this.initialized) throw new Error('not_ready');
          const [input, signal] = request.a as [object, AbortSignal?];
          const parsedInput = parseRequest(request.m, input);
          if (
            signal !== undefined &&
            !v.is(
              v.object({
                aborted: v.boolean(),
                addEventListener: v.function(),
                removeEventListener: v.function(),
              }),
              signal,
            )
          ) {
            throw new Error('invalid_input');
          }
          if (signal?.aborted) throw new Error('cancelled');
          if (this.cancellations.size >= 64) throw new Error('limit_exceeded');
          let cancel!: (error: Error) => void;
          const cancelled = new Promise<never>((_, reject) => {
            cancel = reject;
          });
          const abort = () => cancel(new Error('cancelled'));
          this.cancellations.add(cancel);
          signal?.addEventListener('abort', abort, { once: true });
          try {
            const result: unknown = await Promise.race([
              next({ ...request, a: [parsedInput] }),
              cancelled,
            ]);
            if (this.closed) throw new Error('runtime_closed');
            validateResult(request.m, result);
          } finally {
            signal?.removeEventListener('abort', abort);
            this.cancellations.delete(cancel);
          }
        },
      },
    );
    this.data = this.rpc;
    void (options.clock ?? systemClock).sleep(timeout, deadline.signal).then(
      () => this.close(new Error('initialization_failed')),
      () => {},
    );
    try {
      host.start({
        instanceId: this.instanceId,
        receive: (text) => this.receive(text),
        fail: () => this.close(new Error('host_failed')),
      });
    } catch {
      this.close(new Error('initialization_failed'));
    }
  }

  onChange(listener: (change: DataChange) => void): () => void {
    if (this.closed) return () => {};
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }
  onClose(listener: () => void): () => void {
    if (this.closed) {
      listener();
      return () => {};
    }
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }
  dispose(): void {
    this.close(new Error('disposed'));
  }

  private close(error: Error): void {
    if (this.closed) return;
    this.settleReady(undefined, error);
    for (const cancel of this.cancellations) cancel(error);
    this.rpc.$close(error);
    this.changeListeners.clear();
    for (const listener of this.closeListeners) listener();
    this.closeListeners.clear();
    try {
      this.host.dispose();
    } catch {
      // Local delivery is already closed even if native teardown fails.
    }
  }

  private receive(text: string): void {
    if (this.closed) return;
    try {
      const message = parseMessage(text);
      if (message.instanceId !== this.instanceId) return;
      if (message.protocol !== DATA_PROTOCOL) throw new Error('invalid_response');
      if (message.type === 'failed') {
        this.close(new Error('initialization_failed'));
        return;
      }
      if (message.type === 'ready' && !this.initialized) {
        const environment = parseEnvironment(message.environment);
        this.initialized = true;
        this.settleReady(environment);
        return;
      }
      if (!this.initialized) throw new Error('invalid_response');
      if (message.type === 'change') {
        const change = parseChange(message);
        for (const listener of this.changeListeners) {
          if (this.closed) break;
          listener(change);
        }
        return;
      }
      if (
        message.type !== 'rpc' ||
        !record(message.rpc) ||
        !v.is(
          v.looseObject({
            t: v.literal('s'),
            i: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
          }),
          message.rpc,
        )
      ) {
        throw new Error('invalid_response');
      }
      const rpc: Record<string, unknown> = message.rpc;
      // Route payload errors through birpc: settled IDs are ignored; only the matched call rejects.
      if (Object.hasOwn(rpc, 'r') === Object.hasOwn(rpc, 'e')) {
        delete rpc.r;
        rpc.e = 'invalid_response';
      }
      if (Object.hasOwn(rpc, 'e')) {
        const error = v.safeParse(v.pipe(v.string(), v.maxLength(128)), rpc.e);
        rpc.e = new Error(error.success ? error.output : 'invalid_response');
      }
      this.receiveRpc(rpc);
    } catch {
      this.close(new Error('invalid_response'));
    }
  }
}
