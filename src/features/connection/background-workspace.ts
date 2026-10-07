import type { LodyClient } from '@lody-mobile/sdk';
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
import type { CachedBootstrap } from './workspace-bootstrap-cache';
import { readCachedBootstrap, writeCachedBootstrap } from './workspace-bootstrap-cache';

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

/** Machine order is not part of the contract, so compare the sets. */
function sameMachineIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const sorted = [...left].sort();
  const other = [...right].sort();
  return sorted.every((id, index) => id === other[index]);
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

  /**
   * The live proof that this credential still reaches this workspace, and who it belongs
   * to. Every connect reaches the server for the grant; only these two calls are cached.
   */
  private async verifyIdentity(
    client: LodyClient,
    token: string,
    workspaceId: string,
    signal: AbortSignal,
  ) {
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
    return account.user.id;
  }

  /**
   * Re-check a bootstrap that was served from cache, off the blocking path.
   *
   * This is the trade the cache buys: the identity, membership and machine directory are
   * still verified against the server on every connect, they simply no longer stand between
   * the user and a connected panel. A failed revalidation leaves the live connection alone
   * and lets the entry age out, so a transient outage cannot tear down a working session; a
   * revalidation that disagrees means the workspace really changed, and the honest response
   * is to drop the connection so the next attempt redraws from live data.
   */
  private async revalidateCachedBootstrap(
    session: StoredSession,
    cached: CachedBootstrap,
    client: LodyClient,
    directory: ConvexCloudDirectory,
    signal: AbortSignal,
  ) {
    const workspaceId = session.workspaceId;
    if (!workspaceId) return;
    try {
      const accountId = await this.verifyIdentity(
        client,
        session.token.access_token,
        workspaceId,
        signal,
      );
      const machineIds = (await directory.listMachines(workspaceId, { signal })).map(
        (row) => row.machineId,
      );
      const diverged =
        accountId !== cached.accountId || !sameMachineIds(machineIds, cached.machineIds);
      // Record what the server said before dropping the connection, so the next attempt
      // bootstraps from the corrected facts instead of replaying this same disagreement.
      await writeCachedBootstrap(session, {
        accountId,
        gatewayBaseUrl: cached.gatewayBaseUrl,
        machineIds,
      });
      if (diverged) this.reset();
    } catch (error) {
      console.warn('Cached workspace bootstrap could not be revalidated', error);
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
    const cached = await readCachedBootstrap(session);
    // The grant is requested on every connect, warm or cold: it is the live proof that
    // this credential still reaches this workspace, which is why the cache below is safe.
    const [initialGrant, accountId] = await Promise.all([
      client.streams.getGrant(token, workspaceId, { signal }),
      cached
        ? Promise.resolve(cached.accountId)
        : this.verifyIdentity(client, token, workspaceId, signal),
    ]);
    signal.throwIfAborted();
    let grant = initialGrant;
    const baseUrl = grant.gatewayBaseUrl;
    if (!baseUrl) throw new Error('Streams grant did not provide a gateway URL.');
    await requireApiAccess(new URL(baseUrl).origin);
    // Derived facts from a gateway this session no longer talks to describe a different
    // workspace, so a moved gateway falls back to the full live path.
    const warm = cached?.gatewayBaseUrl === baseUrl ? cached : null;
    const accountKey = JSON.stringify([
      workspaceScope(session.config.authOrigin, session.config.clientId, accountId, workspaceId),
      productConfig.convexOrigin,
    ]);
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
      const machineIds =
        warm?.machineIds ??
        (await directory.listMachines(workspaceId, { signal })).map((row) => row.machineId);
      await connection.machines.listMachineInfos(machineIds);
      // The common single-machine workspace can prepare its agent catalogue before UI opens.
      if (machineIds.length === 1) await connection.machines.open(machineIds[0]!);
      signal.throwIfAborted();
      if (warm) void this.revalidateCachedBootstrap(session, warm, client, directory, signal);
      else await writeCachedBootstrap(session, { accountId, gatewayBaseUrl: baseUrl, machineIds });
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
