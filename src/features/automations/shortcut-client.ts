import type { ShortcutRuntimeSnapshot } from '@lody-mobile/sdk';
import {
  BetterAuthConvexJwtProvider,
  ConvexPromptShortcuts,
  LocalShortcutStore,
  PromptShortcutRuntime,
  PromptShortcutSync,
} from '@lody-mobile/sdk';
import { createPromptShortcutRepo } from '@lody-mobile/sdk/loro';
import { IndexedDBStorageAdaptor } from 'loro-repo/storage/indexeddb';

import { initializeLoroWasm } from '../../shared/loro/wasm';
import type { ChatShortcuts } from '../connection/client';
import { requireApiAccess } from '../connection/state';
import { cloudFetch } from '../connection/worker-fetch';

const closingDatabases = new Map<string, Promise<void>>();

/** Storage and identity belong to the feature; each shortcut resource gets its own SDK grant. */
export class SyncedShortcuts implements ChatShortcuts {
  private state: ShortcutRuntimeSnapshot = {
    entries: [],
    pendingIds: [],
    errors: {},
    loading: true,
  };
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  private runtime: PromptShortcutRuntime | undefined;
  private repo: Awaited<ReturnType<typeof createPromptShortcutRepo>> | undefined;
  private cloud: ConvexPromptShortcuts | undefined;
  private opening: Promise<void> | undefined;
  private refreshing: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private unwatch: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly database: string;
  private directoryFailure: { error: unknown } | undefined;
  private initializationFailure: { error: unknown } | undefined;
  constructor(
    private readonly options: {
      accountKey: string;
      workspaceId: string;
      userId: string;
      authOrigin: string;
      convexOrigin: string;
      getToken: () => string;
      requireAccess?: typeof requireApiAccess;
    },
  ) {
    this.database = `lody:prompt-shortcuts:${JSON.stringify([options.accountKey, options.workspaceId, options.userId, options.authOrigin, options.convexOrigin])}`;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private active() {
    this.lifetime.signal.throwIfAborted();
  }
  private publish(state: ShortcutRuntimeSnapshot) {
    if (this.lifetime.signal.aborted) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  private syncState = () => {
    const snapshot = this.runtime?.getSnapshot() ?? this.state;
    const errors = { ...snapshot.errors };
    if (this.directoryFailure) errors.directory = this.directoryFailure.error;
    if (this.initializationFailure) errors.initialization = this.initializationFailure.error;
    this.publish({ ...snapshot, errors });
  };
  connect = () => {
    this.active();
    if (this.runtime) return Promise.resolve();
    return (this.opening ??= this.open().catch((error: Error) => {
      if (!this.runtime) this.initializationFailure = { error };
      this.state = { ...this.state, loading: false };
      this.syncState();
      throw error;
    }));
  };
  private async open() {
    await closingDatabases.get(this.database);
    this.active();
    const access = this.options.requireAccess ?? requireApiAccess;
    await Promise.all([access(this.options.authOrigin), access(this.options.convexOrigin)]);
    this.active();
    const fetch = cloudFetch();
    const jwt = new BetterAuthConvexJwtProvider({
      authOrigin: this.options.authOrigin,
      fetch,
      getSessionBearer: async () => {
        this.active();
        return this.options.getToken();
      },
    });
    const cloud = new ConvexPromptShortcuts({
      origin: this.options.convexOrigin,
      workspaceId: this.options.workspaceId,
      userId: this.options.userId,
      fetch,
      getJwt: (signal) => jwt.getJwt(AbortSignal.any([this.lifetime.signal, signal])),
    });
    await initializeLoroWasm();
    this.active();
    const repo = await createPromptShortcutRepo({
      storageAdapter: new IndexedDBStorageAdaptor({ dbName: this.database }),
    });
    this.repo = repo;
    let store: LocalShortcutStore | undefined;
    try {
      this.active();
      store = await LocalShortcutStore.open({
        repo,
        workspaceId: this.options.workspaceId,
        userId: this.options.userId,
      });
      this.active();
      const sync = new PromptShortcutSync({
        repo,
        now: Date.now,
        grant: async (resource, write) => {
          this.active();
          const grant = await cloud.getStreamToken(resource, write, {
            signal: this.lifetime.signal,
          });
          this.active();
          await access(grant.gatewayBaseUrl);
          this.active();
          return grant;
        },
      });
      this.runtime = new PromptShortcutRuntime(store, {
        acquire: (resource, write) => {
          this.active();
          return sync.acquire(resource, write);
        },
        stage: (record) => {
          this.active();
          return cloud.stage(record, { signal: this.lifetime.signal });
        },
        activate: (record) => {
          this.active();
          return cloud.activate(record, { signal: this.lifetime.signal });
        },
        settle: (record) => {
          this.active();
          return cloud.settle(record, { signal: this.lifetime.signal });
        },
        revoke: (entry) => {
          this.active();
          return cloud.revoke(entry, { signal: this.lifetime.signal });
        },
        dispose: () => sync.dispose(),
      });
      this.initializationFailure = undefined;
      this.cloud = cloud;
      this.unwatch = this.runtime.subscribe(this.syncState);
      this.syncState();
      this.timer = setInterval(() => {
        void this.refresh().catch(() => {});
      }, 15_000);
      window.addEventListener('online', this.online);
      await this.refresh();
      this.active();
      void this.runtime.flush().catch(() => {});
    } catch (error) {
      if (!this.runtime) {
        try {
          await store?.dispose();
        } finally {
          await repo.destroy();
          this.repo = undefined;
        }
      }
      throw error;
    }
  }
  private online = () => {
    void this.retry().catch(() => {});
  };
  private refresh() {
    this.active();
    return (this.refreshing ??= (async () => {
      if (!this.cloud || !this.runtime) return;
      try {
        const directory = await this.cloud.listAccessibleDocuments({
          signal: this.lifetime.signal,
        });
        this.active();
        await this.runtime.setDirectory(directory);
        this.active();
        this.directoryFailure = undefined;
        this.syncState();
      } catch (error) {
        this.directoryFailure = { error };
        this.state = { ...this.state, loading: false };
        this.syncState();
        throw error;
      }
    })().finally(() => {
      this.refreshing = undefined;
    }));
  }
  retry = async () => {
    this.active();
    if (!this.runtime) {
      this.opening = undefined;
      await this.connect();
    } else {
      await this.refresh();
      await this.runtime.retry();
      this.syncState();
    }
  };
  read: ChatShortcuts['read'] = async (entry) => {
    await this.connect();
    this.active();
    await this.refresh();
    this.active();
    const value = await this.runtime!.read(entry);
    this.active();
    return value;
  };
  save: ChatShortcuts['save'] = async (input) => {
    await this.connect();
    this.active();
    const entry = await this.runtime!.save(input);
    this.active();
    return entry;
  };
  remove: ChatShortcuts['remove'] = async (entry) => {
    await this.connect();
    this.active();
    await this.runtime!.remove(entry);
    this.active();
  };
  close = () => {
    if (this.closing) return this.closing;
    this.lifetime.abort(new Error('Shortcut identity ended'));
    clearInterval(this.timer);
    window.removeEventListener('online', this.online);
    this.unwatch?.();
    this.listeners.clear();
    this.closing = (async () => {
      await this.opening?.catch(() => {});
      try {
        await this.runtime?.dispose();
      } finally {
        await this.repo?.destroy();
      }
    })();
    closingDatabases.set(this.database, this.closing);
    void this.closing
      .finally(() => {
        if (closingDatabases.get(this.database) === this.closing)
          closingDatabases.delete(this.database);
      })
      .catch(() => {});
    return this.closing;
  };
}
