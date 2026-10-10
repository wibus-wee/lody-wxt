import type { LoroRepo } from 'loro-repo';
import * as v from 'valibot';

import type { MachineInfo } from '../domain/machine.js';
import { acquireWithin, bounded } from './lifecycle.js';
import type { MachinePresence } from './machine-presence.js';
import { capabilitySchema, modelCapabilitiesSchema } from './machine-protocol.js';

const machineInfoSchema = v.object({
  id: v.string(),
  name: v.exactOptional(v.string()),
  ownerUserId: v.exactOptional(v.string()),
  hostType: v.exactOptional(v.picklist(['user', 'cloud'])),
  cliVersion: v.exactOptional(v.string()),
  os: v.exactOptional(v.string()),
  timeZone: v.exactOptional(v.string()),
  protocolCapabilities: v.exactOptional(
    v.record(v.string(), v.pipe(v.number(), v.integer(), v.minValue(1))),
  ),
});

const rowSchema = v.object({
  key: v.array(v.union([v.string(), v.number()])),
  value: v.exactOptional(v.unknown()),
});
const agentSchema = v.looseObject({
  id: v.string(),
  name: v.string(),
  cliType: v.picklist(['builtin', 'registry', 'custom']),
  agentType: v.string(),
  prompt: v.exactOptional(v.string()),
});
const projectSchema = v.looseObject({
  id: v.string(),
  name: v.string(),
  rootPath: v.string(),
  createdAtMs: v.number(),
  lastOpenedAtMs: v.exactOptional(v.number()),
});
export type MachineProject = v.InferOutput<typeof projectSchema>;
export type MachineCapabilities = v.InferOutput<typeof capabilitySchema>;

export class MachineFlockDirectory {
  private readonly lifecycle = new AbortController();
  private readonly handles = new Set<() => Promise<void>>();
  private readonly pending = new Set<Promise<void>>();
  constructor(
    private readonly options: {
      repo: LoroRepo;
      workspaceId: string;
      presence?: Pick<MachinePresence, 'getStatus' | 'subscribe'>;
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ) {}
  private signal() {
    return AbortSignal.any([
      this.lifecycle.signal,
      AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      ...(this.options.signal ? [this.options.signal] : []),
    ]);
  }
  close = async () => {
    this.lifecycle.abort(new Error('Machine directory closed'));
    await Promise.allSettled(this.pending);
    await Promise.all(Array.from(this.handles, (close) => close()));
  };

  listMachineInfos = async (machineIds: readonly string[]): Promise<MachineInfo[]> => {
    const signal = this.signal();
    signal.throwIfAborted();
    const rows = await bounded(this.options.repo.listDoc(), signal);
    const metadata = new Map(
      rows
        .filter((row) => row.docId.startsWith('machine-') && !row.deleted)
        .map((row) => [row.docId.slice('machine-'.length), row.meta]),
    );
    return machineIds.map((id) => {
      const meta = metadata.get(id);
      if (meta === undefined) return { id };
      const info = v.parse(machineInfoSchema, meta);
      if (info.id !== id) throw new Error('Machine metadata identity mismatch');
      return {
        ...info,
        ...(this.options.presence ? { status: this.options.presence.getStatus(id) } : {}),
      };
    });
  };

  subscribeMachineInfos = (listener: () => void) => {
    this.signal().throwIfAborted();
    const watch = this.options.repo.watch(listener);
    const unsubscribePresence = this.options.presence?.subscribe(listener);
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      this.handles.delete(close);
      watch.unsubscribe();
      unsubscribePresence?.();
    };
    this.handles.add(close);
    return () => {
      void close();
    };
  };

  open = (machineId: string) => {
    const result = this.load(machineId);
    const pending = result.then(
      () => {},
      () => {},
    );
    this.pending.add(pending);
    void pending.finally(() => this.pending.delete(pending));
    return result;
  };
  private async load(machineId: string) {
    const signal = this.signal();
    signal.throwIfAborted();
    const id = `${this.options.workspaceId}:mf:${machineId}`;
    const lease = await acquireWithin(this.options.repo.acquireFlockDoc(id), signal, (resource) =>
      resource.release(),
    );
    let room;
    try {
      room = await acquireWithin(
        this.options.repo.joinFlockDocRoom(id),
        signal,
        async (resource) => {
          resource.unsubscribe();
        },
      );
    } catch (error) {
      await lease.release();
      throw error;
    }
    try {
      await bounded(room.firstSyncedWithRemote, signal);
    } catch (error) {
      room.unsubscribe();
      await lease.release();
      throw error;
    }
    const read = () => {
      const rows = v.parse(v.array(rowSchema), lease.flock.scanValues());
      const capabilities = Object.fromEntries(
        rows
          .filter((row) => row.key[0] === 'acpCapability' && row.value !== undefined)
          .map((row) => [v.parse(v.string(), row.key[1]), v.parse(capabilitySchema, row.value)]),
      );
      for (const row of rows) {
        if (row.key[0] !== 'acpModelCapability' || row.value === undefined) continue;
        const declaration = v.parse(modelCapabilitiesSchema, row.value);
        const key = v.parse(v.string(), row.key[1]);
        const entry = capabilities[key];
        if (entry && entry.sourceVersion === declaration.sourceVersion)
          capabilities[key] = { ...entry, declaredModelControls: declaration.models };
      }
      return {
        machineId,
        agents: rows
          .filter((row) => row.key[0] === 'agentConfig' && row.value !== undefined)
          .map((row) => v.parse(agentSchema, row.value)),
        projects: rows
          .filter((row) => row.key[0] === 'localProject' && row.value !== undefined)
          .map((row) => ({
            localProjectId: v.parse(v.string(), row.key[1]),
            ...v.parse(projectSchema, row.value),
          })),
        capabilities,
      };
    };
    let closed = false;
    const subscriptions = new Set<() => void>();
    const close = async () => {
      if (closed) return;
      closed = true;
      this.handles.delete(close);
      for (const unsubscribe of subscriptions) unsubscribe();
      room.unsubscribe();
      await lease.release();
    };
    this.handles.add(close);
    signal.throwIfAborted();
    return {
      read,
      subscribe: (listener: (snapshot: ReturnType<typeof read>) => void) => {
        if (closed) throw new Error('Machine handle closed');
        const unsubscribe = lease.flock.subscribe(() => listener(read()));
        subscriptions.add(unsubscribe);
        return () => {
          subscriptions.delete(unsubscribe);
          unsubscribe();
        };
      },
      archiveSession: async (sessionId: string, requestedBy: string) => {
        if (closed) throw new Error('Machine handle closed');
        this.signal().throwIfAborted();
        lease.flock.set(['cmd', 'archiveSession', sessionId], {
          v: 1,
          requestedAt: Date.now(),
          requestedBy,
        });
        lease.flock.commit();
        await this.options.repo.persistFlockDocNow(id, lease.flock);
        await bounded(room.waitUntilSynced(), this.signal());
      },
      deleteSession: async (sessionId: string) => {
        if (closed) throw new Error('Machine handle closed');
        this.signal().throwIfAborted();
        lease.flock.set(['cmd', 'deleteSession', sessionId], { v: 1, requestedAt: Date.now() });
        lease.flock.commit();
        await this.options.repo.persistFlockDocNow(id, lease.flock);
        await bounded(room.waitUntilSynced(), this.signal());
      },
      close,
    };
  }
}
