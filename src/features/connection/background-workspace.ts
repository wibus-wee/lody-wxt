import {
  BetterAuthConvexJwtProvider,
  ConvexCloudDirectory,
  createLodyClient,
  StreamsMachineCommands,
} from '@lody-mobile/sdk';
import { createLoroSessionRuntime } from '@lody-mobile/sdk/loro';
import { JsonRpcStreams } from '@lody-mobile/sdk/rpc';
import { IndexedDBStorageAdaptor } from 'loro-repo/storage/indexeddb';
import * as v from 'valibot';
import { initializeWorkerWasm } from 'virtual:lody-worker-wasm';
import { browser } from 'wxt/browser';

import { productConfig } from '../../app/product-config';
import type { StoredSession } from '../account/model';
import { nullableSessionSchema, sameConfig, storedConfigSchema } from '../account/model';
import { createDocumentCursorStore } from '../conversations/runtime-storage';
import { requireApiAccess, workspaceScope } from './state';

type Runtime = Awaited<ReturnType<typeof createLoroSessionRuntime>>;
export interface BackgroundWorkspace {
  session: StoredSession;
  accountId: string;
  accountKey: string;
  gatewayOrigin: string;
  machineIds: string[];
  connection: Runtime;
  commands: StreamsMachineCommands;
  signal: AbortSignal;
}
interface Attempt {
  key: string;
  lifecycle: AbortController;
  result: Promise<BackgroundWorkspace>;
}

/** The worker owns synchronization; UI ports own only their document leases. */
export class BackgroundWorkspaceOwner {
  private current: Attempt | undefined;
  private generation = 0;
  private writes: Promise<void> = Promise.resolve();
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();

  subscribeReset(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private status(
    status: 'disconnected' | 'connecting' | 'connected' | 'error',
    workspaceId: string | null,
    error: string | null = null,
  ) {
    const generation = this.generation;
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        if (generation !== this.generation) return;
        await browser.storage.session.set({
          'lody:workspace:status': { status, workspaceId, error },
        });
      });
    return this.writes;
  }

  reset() {
    ++this.generation;
    clearTimeout(this.expiry);
    const previous = this.current;
    this.current = undefined;
    previous?.lifecycle.abort(new Error('Workspace identity changed'));
    for (const listener of this.listeners) listener();
  }

  async revalidateAccess() {
    const attempt = this.current;
    if (!attempt) return this.ensure();
    try {
      const ready = await attempt.result;
      await Promise.all([
        requireApiAccess(ready.session.config.authOrigin),
        requireApiAccess(productConfig.convexOrigin),
        requireApiAccess(ready.gatewayOrigin),
      ]);
      return ready;
    } catch {
      if (this.current === attempt) this.reset();
      return this.ensure();
    }
  }

  async ensure(): Promise<BackgroundWorkspace | null> {
    const generation = this.generation;
    const stored = await browser.storage.local.get(['accountSession', 'accountConfig']);
    if (generation !== this.generation) return this.ensure();
    const parsed = v.safeParse(
      v.object({ session: nullableSessionSchema, config: storedConfigSchema }),
      {
        session: stored.accountSession ?? null,
        config: stored.accountConfig ?? null,
      },
    );
    if (!parsed.success) {
      this.reset();
      await this.status('error', null, 'Stored workspace credentials are invalid.');
      throw new v.ValiError(parsed.issues);
    }
    const { session, config } = parsed.output;
    if (
      !session?.workspaceId ||
      !config ||
      !sameConfig(config, session.config) ||
      !sameConfig(config, productConfig) ||
      session.expiresAtMs <= Date.now()
    ) {
      this.reset();
      await this.status('disconnected', null);
      return null;
    }
    const key = JSON.stringify(session);
    if (this.current?.key === key) return this.current.result;
    this.reset();
    const lifecycle = new AbortController();
    const attempt: Attempt = {
      key,
      lifecycle,
      result: Promise.resolve().then(async () => {
        lifecycle.signal.throwIfAborted();
        await this.status('connecting', session.workspaceId);
        lifecycle.signal.throwIfAborted();
        return this.connect(session, lifecycle.signal);
      }),
    };
    this.current = attempt;
    this.expiry = setTimeout(
      () => {
        if (this.current === attempt) {
          this.reset();
          void this.status('disconnected', null);
        }
      },
      Math.min(session.expiresAtMs - Date.now(), 2_147_483_647),
    );
    try {
      const ready = await attempt.result;
      lifecycle.signal.throwIfAborted();
      await this.status('connected', session.workspaceId);
      return ready;
    } catch (error) {
      if (this.current === attempt) {
        this.reset();
        await this.status(
          'error',
          session.workspaceId,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }

  private async connect(session: StoredSession, signal: AbortSignal): Promise<BackgroundWorkspace> {
    const workspaceId = session.workspaceId;
    if (!workspaceId) throw new Error('Choose a workspace first.');
    await Promise.all([
      initializeWorkerWasm(),
      requireApiAccess(session.config.authOrigin),
      requireApiAccess(productConfig.convexOrigin),
    ]);
    signal.throwIfAborted();
    const client = createLodyClient({ ...session.config, requestTimeoutMs: 15_000 });
    const token = session.token.access_token;
    const [account, workspaces] = await Promise.all([
      client.identity.getAccount(token, { signal }),
      client.workspaces.list(token, { signal }),
    ]);
    signal.throwIfAborted();
    if (
      Date.parse(account.session.expiresAt) <= Date.now() ||
      !workspaces.some((row) => row.id === workspaceId)
    )
      throw new Error('Workspace authorization expired or was removed.');
    const accountId = account.user.id;
    const accountKey = JSON.stringify([
      workspaceScope(session.config.authOrigin, session.config.clientId, accountId, workspaceId),
      productConfig.convexOrigin,
    ]);
    let grant = await client.streams.getGrant(token, workspaceId, { signal });
    const baseUrl = grant.gatewayBaseUrl;
    if (!baseUrl) throw new Error('Streams grant did not provide a gateway URL.');
    await requireApiAccess(new URL(baseUrl).origin);
    let expiresAt = Date.now() + grant.expiresIn * 1000;
    let refreshing: Promise<void> | undefined;
    const auth = async () => {
      signal.throwIfAborted();
      if (session.expiresAtMs <= Date.now()) throw new Error('Workspace authorization expired.');
      if (Date.now() >= expiresAt - 10_000) {
        refreshing ??= client.streams
          .getGrant(token, workspaceId, { signal })
          .then((next) => {
            signal.throwIfAborted();
            if (next.gatewayBaseUrl !== baseUrl)
              throw new Error('Streams gateway changed. Reconnect the workspace.');
            grant = next;
            expiresAt = Date.now() + next.expiresIn * 1000;
          })
          .finally(() => {
            refreshing = undefined;
          });
        await refreshing;
      }
      return grant.token;
    };
    const commands = new StreamsMachineCommands({
      workspaceId,
      streams: new JsonRpcStreams({ baseUrl, auth }),
    });
    const connection = await createLoroSessionRuntime({
      workspaceId,
      streamsBaseUrl: baseUrl,
      auth,
      commands,
      signal,
      storageAdapter: new IndexedDBStorageAdaptor({
        dbName: `lody:repo:${accountKey}`,
        durability: 'strict',
      }),
      documentRemoteCursorStore: createDocumentCursorStore(accountKey),
    });
    try {
      const jwt = new BetterAuthConvexJwtProvider({
        authOrigin: session.config.authOrigin,
        getSessionBearer: async () => {
          signal.throwIfAborted();
          return token;
        },
      });
      const directory = new ConvexCloudDirectory({ convexUrl: productConfig.convexOrigin, jwt });
      const machineIds = (await directory.listMachines(workspaceId, { signal })).map(
        (row) => row.machineId,
      );
      await connection.machines.listMachineInfos(machineIds);
      // The common single-machine workspace can prepare its agent catalogue before UI opens.
      if (machineIds.length === 1) await connection.machines.open(machineIds[0]!);
      signal.throwIfAborted();
      return {
        session,
        accountId,
        accountKey,
        gatewayOrigin: new URL(baseUrl).origin,
        machineIds,
        connection,
        commands,
        signal,
      };
    } catch (error) {
      await connection.close();
      throw error;
    }
  }
}
