import { EphemeralStoreAdaptor, EphemeralStreamCrdt } from '@loro-dev/streams-crdt/loro';
import { EphemeralStore } from 'loro-crdt';
import * as v from 'valibot';

import type { MachineInfo } from '../domain/machine.js';

// Lody's workspace presence protocol (packages/shared/src/presence.ts).
const trailingSlash = /\/$/;
const ttlMs = 90_000;
const heartbeatMs = 30_000;
const machinePresenceSchema = v.object({
  kind: v.literal('machine'),
  machineId: v.pipe(v.string(), v.minLength(1)),
  instanceId: v.pipe(v.string(), v.minLength(1)),
  updatedAt: v.pipe(v.number(), v.finite()),
});
type PresenceTransport = Pick<EphemeralStreamCrdt, 'join' | 'rejoin' | 'close'>;

/** Observes ephemeral heartbeats; durable registration metadata is never liveness. */
export class MachinePresence {
  private readonly store = new EphemeralStore(ttlMs);
  private readonly transport: PresenceTransport;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeStore: () => void;
  private readonly timer: ReturnType<typeof setInterval>;
  private unsubscribeRoom: (() => void) | undefined;
  private synced = false;
  private closed = false;
  private lastStatusAt: number;
  private status = 'connecting';
  private readonly now: () => number;

  constructor(options: {
    workspaceId: string;
    baseUrl: string;
    auth: NonNullable<ConstructorParameters<typeof EphemeralStreamCrdt>[0]['auth']>;
    now?: () => number;
    createTransport?: (
      options: ConstructorParameters<typeof EphemeralStreamCrdt>[0],
    ) => PresenceTransport;
  }) {
    this.now = options.now ?? Date.now;
    this.lastStatusAt = this.now();
    const url = new URL(options.baseUrl);
    if (url.protocol !== 'https:') throw new Error('invalid_configuration');
    url.pathname = `${url.pathname.replace(trailingSlash, '')}/ds/lody/${encodeURIComponent(`${options.workspaceId}:meta`)}`;
    url.searchParams.set('ephemeral', 'presence');
    const transportOptions = {
      streamUrl: url.toString(),
      auth: options.auth,
      adaptor: EphemeralStoreAdaptor(this.store),
    };
    this.transport =
      options.createTransport?.(transportOptions) ?? new EphemeralStreamCrdt(transportOptions);
    this.unsubscribeStore = this.store.subscribe(() => this.notify());
    this.timer = setInterval(() => {
      this.notify();
      if (!this.synced && this.now() - this.lastStatusAt >= heartbeatMs) {
        this.lastStatusAt = this.now();
        this.transport.rejoin();
      }
    }, heartbeatMs);
    void this.transport
      .join({
        onStatusChange: (status) => {
          if (this.closed) return;
          if (status !== this.status) this.lastStatusAt = this.now();
          this.status = status;
          this.synced = status === 'joined';
          this.notify();
        },
      })
      .then((result) => {
        if (result.ok) {
          if (this.closed) result.value.unsubscribe();
          else this.unsubscribeRoom = () => result.value.unsubscribe();
        } else this.unavailable();
      })
      .catch(() => this.unavailable());
  }

  getStatus = (machineId: string): NonNullable<MachineInfo['status']> => {
    if (this.closed) return 'unknown';
    for (const value of Object.values(this.store.getAllStates())) {
      const parsed = v.safeParse(machinePresenceSchema, value);
      if (
        parsed.success &&
        parsed.output.machineId === machineId &&
        this.now() - parsed.output.updatedAt < ttlMs
      )
        return 'online';
    }
    return this.synced ? 'offline' : 'unknown';
  };

  subscribe = (listener: () => void) => {
    if (this.closed) throw new Error('Machine presence closed');
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    if (!this.closed) for (const listener of this.listeners) listener();
  }
  private unavailable() {
    if (this.closed) return;
    this.synced = false;
    this.status = 'error';
    this.notify();
  }
  close = async () => {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.unsubscribeStore();
    this.unsubscribeRoom?.();
    this.listeners.clear();
    try {
      await this.transport.close();
    } finally {
      this.store.destroy();
    }
  };
}
