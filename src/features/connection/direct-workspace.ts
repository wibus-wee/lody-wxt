import type { LodyClient } from '@lody-mobile/sdk';
import {
  BetterAuthConvexJwtProvider,
  ConvexCloudDirectory,
  StreamsMachineCommands,
} from '@lody-mobile/sdk';
import { createLoroSessionRuntime } from '@lody-mobile/sdk/loro';
import { JsonRpcStreams } from '@lody-mobile/sdk/rpc';
import { IndexedDBStorageAdaptor } from 'loro-repo/storage/indexeddb';

import { initializeLoroWasm } from '../../shared/loro/wasm';
import { createDocumentCursorStore } from '../conversations/runtime-storage';
import { cloudFetch } from './worker-fetch';

/** The connection surface every caller of this module needs, independent of the runtime. */
export interface DirectConnection {
  close: () => Promise<void>;
}

export interface DirectWorkspaceOptions<TConnection extends DirectConnection> {
  accountKey: string;
  workspaceId: string;
  authOrigin: string;
  convexUrl: string;
  token: string;
  client: LodyClient;
  requireAccess: (origin: string) => Promise<void>;
  onGatewayOrigin: (origin: string) => void;
  /** Test seams. The defaults live here so the extension never pulls them in eagerly. */
  ports?:
    | {
        createConnection?:
          | ((options: Parameters<typeof createLoroSessionRuntime>[0]) => Promise<TConnection>)
          | undefined;
        directory?: Pick<ConvexCloudDirectory, 'listMachines'> | undefined;
      }
    | undefined;
}
export interface DirectWorkspace<TConnection extends DirectConnection> {
  connection: TConnection;
  machineIds: string[];
}

/**
 * Connect a workspace directly from a page, without the extension background broker.
 *
 * Only `web` (and the Storybook/dev harness) reach this path: an extension surface always
 * goes through `connectBackgroundWorkspace`, where the service worker owns the Loro
 * runtime. Keeping the direct path in its own module means the wasm-bindgen glue, the
 * streams client and zstd stay out of the extension surface entry chunk, which every popup
 * and side panel open would otherwise have to parse.
 */
export async function connectDirectWorkspace<TConnection extends DirectConnection>(
  options: DirectWorkspaceOptions<TConnection>,
  signal: AbortSignal,
): Promise<DirectWorkspace<TConnection>>;
export async function connectDirectWorkspace(
  options: DirectWorkspaceOptions<DirectConnection>,
  signal: AbortSignal,
): Promise<DirectWorkspace<DirectConnection>>;
export async function connectDirectWorkspace(
  options: DirectWorkspaceOptions<DirectConnection>,
  signal: AbortSignal,
): Promise<DirectWorkspace<DirectConnection>> {
  const fetch = cloudFetch();
  const jwt = new BetterAuthConvexJwtProvider({
    authOrigin: options.authOrigin,
    fetch,
    getSessionBearer: async () => {
      signal.throwIfAborted();
      return options.token;
    },
  });
  const directory =
    options.ports?.directory ??
    new ConvexCloudDirectory({ convexUrl: options.convexUrl, jwt, fetch });
  let grant = await options.client.streams.getGrant(options.token, options.workspaceId, { signal });
  signal.throwIfAborted();
  const baseUrl = grant.gatewayBaseUrl;
  if (!baseUrl) throw new Error('Streams grant did not provide a gateway URL.');
  options.onGatewayOrigin(new URL(baseUrl).origin);
  await options.requireAccess(new URL(baseUrl).origin);
  signal.throwIfAborted();
  let expiresAt = Date.now() + grant.expiresIn * 1000;
  let refresh: Promise<void> | null = null;
  const auth = async () => {
    signal.throwIfAborted();
    if (Date.now() >= expiresAt - 10_000) {
      refresh ??= options.client.streams
        .getGrant(options.token, options.workspaceId, { signal })
        .then((next) => {
          signal.throwIfAborted();
          if (next.gatewayBaseUrl !== baseUrl)
            throw new Error('Streams gateway changed. Reconnect the workspace.');
          grant = next;
          expiresAt = Date.now() + next.expiresIn * 1000;
        })
        .finally(() => {
          refresh = null;
        });
      await refresh;
    }
    signal.throwIfAborted();
    return grant.token;
  };
  await initializeLoroWasm();
  signal.throwIfAborted();
  const connection = await (options.ports?.createConnection ?? createLoroSessionRuntime)({
    workspaceId: options.workspaceId,
    streamsBaseUrl: baseUrl,
    auth,
    commands: new StreamsMachineCommands({
      workspaceId: options.workspaceId,
      streams: new JsonRpcStreams({ baseUrl, auth }),
    }),
    storageAdapter: new IndexedDBStorageAdaptor({
      dbName: `lody:repo:${options.accountKey}`,
      durability: 'strict',
    }),
    documentRemoteCursorStore: createDocumentCursorStore(options.accountKey),
    signal,
  });
  try {
    const machines = await directory.listMachines(options.workspaceId, { signal });
    return { connection, machineIds: machines.map((row) => row.machineId) };
  } catch (error) {
    await connection.close();
    throw error;
  }
}
