import { compress, decompress } from '@loro-dev/streams-crdt/zstd';
import type { LoroRepoOptions } from 'loro-repo';
import { LoroRepo } from 'loro-repo';
import { createRepoStreamsPersistence, StreamsTransportAdapter } from 'loro-repo/transport/streams';

import { LoroScheduleStorage } from './schedules/infrastructure/loro-schedule-storage.js';
import { ProtocolScheduleRepository } from './schedules/infrastructure/schedule-repository.js';
import type { MachineCommandPort } from './sessions/application/runtime-ports.js';
import { SessionRuntime } from './sessions/application/session-runtime.js';
import { acquireWithin, bounded } from './sessions/infrastructure/lifecycle.js';
import { LoroSessionRepository } from './sessions/infrastructure/loro-session-repository.js';
import { MachineFlockDirectory } from './sessions/infrastructure/machine-flock.js';

export { LoroSessionRepository } from './sessions/infrastructure/loro-session-repository.js';
export {
  type MachineCapabilities,
  MachineFlockDirectory,
  type MachineProject,
} from './sessions/infrastructure/machine-flock.js';

type TransportOptions = ConstructorParameters<typeof StreamsTransportAdapter>[0];

export interface LoroRuntimeOptions {
  workspaceId: string;
  streamsBaseUrl: string;
  auth: TransportOptions['auth'];
  storageAdapter: NonNullable<LoroRepoOptions['storageAdapter']>;
  documentRemoteCursorStore: import('@loro-dev/streams-crdt').RemoteCursorStore;
  commands: MachineCommandPort;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Epoch milliseconds for queue notifications; defaults to Date.now. */
  now?: () => number;
}

export async function createLoroSessionRuntime(options: LoroRuntimeOptions) {
  const url = new URL(options.streamsBaseUrl);
  if (url.protocol !== 'https:' || !options.workspaceId.trim())
    throw new Error('invalid_configuration');
  const lifecycle = new AbortController();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const signal = AbortSignal.any([
    lifecycle.signal,
    AbortSignal.timeout(timeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  const lifetime = AbortSignal.any([lifecycle.signal, ...(options.signal ? [options.signal] : [])]);
  const repo = await acquireWithin(
    LoroRepo.create({
      storageAdapter: options.storageAdapter,
      metaDebounceCommitMs: 0,
    }),
    signal,
    (resource) => resource.destroy(),
  );
  const transport = new StreamsTransportAdapter({
    bucketId: 'lody',
    metaStreamId: `${options.workspaceId}:meta`,
    docStreamId: (docId) =>
      docId.startsWith('session-')
        ? `${options.workspaceId}:s:${docId.slice(8)}`
        : docId.startsWith('schedule-')
          ? `${options.workspaceId}:schedule:${docId.slice(9)}`
          : docId,
    flockDocStreamId: (id) => id,
    auth: options.auth,
    baseUrl: options.streamsBaseUrl,
    persistence: createRepoStreamsPersistence(repo, {
      documentRemoteCursorStore: options.documentRemoteCursorStore,
    }),
    snapshotCodec: {
      compress,
      decompress: (data) =>
        data[0] === 40 && data[1] === 181 && data[2] === 47 && data[3] === 253
          ? decompress(data)
          : Promise.resolve(data),
    },
  });
  try {
    await bounded(repo.addTransport('cloud', transport), signal);
    const meta = await acquireWithin(repo.joinMetaRoom(), signal, async (resource) => {
      resource.unsubscribe();
    });
    await bounded(meta.firstSyncedWithRemote, signal);
    const repository = new LoroSessionRepository({
      repo,
      metaRoom: meta,
      ...(options.now ? { now: options.now } : {}),
      signal: lifetime,
      timeoutMs,
    });
    const runtime = new SessionRuntime(repository, options.commands);
    const machines = new MachineFlockDirectory({
      repo,
      workspaceId: options.workspaceId,
      signal: lifetime,
      timeoutMs,
    });
    let closing: Promise<void> | undefined;
    const close = () =>
      (closing ??= Promise.resolve().then(async () => {
        lifecycle.abort(new Error('Runtime closed'));
        try {
          await machines.close();
          await runtime.close();
        } finally {
          meta.unsubscribe();
          await repo.destroy();
        }
      }));
    lifetime.addEventListener(
      'abort',
      () => {
        void close().catch(() => {});
      },
      { once: true },
    );
    const schedules = new ProtocolScheduleRepository(
      new LoroScheduleStorage({
        repo,
        workspaceId: options.workspaceId,
        signal: lifetime,
        timeoutMs,
      }),
    );
    return { runtime, machines, schedules, repo, close };
  } catch (error) {
    await repo.destroy();
    throw error;
  }
}
