import type { LodyClient } from '@lody-mobile/sdk';
import {
  BetterAuthConvexJwtProvider,
  ConvexCloudDirectory,
  StreamsMachineCommands,
} from '@lody-mobile/sdk';
import type { LoroRuntimeOptions } from '@lody-mobile/sdk/loro';
import { createLoroSessionRuntime } from '@lody-mobile/sdk/loro';
import { JsonRpcStreams } from '@lody-mobile/sdk/rpc';

import { productConfig } from '../../app/product-config';
import { initializeLoroWasm } from '../../shared/loro/wasm';
import { connectBackgroundWorkspace } from '../connection/background-client';
import { workspaceScope } from '../connection/state';
import { cloudFetch } from '../connection/worker-fetch';
import { createDocumentCursorStore } from './runtime-storage';

export interface WorkspaceConnectionOptions {
  accountId: string;
  workspaceId: string;
  token: string;
  authOrigin: string;
  convexUrl: string;
  client: LodyClient;
  storageAdapter: LoroRuntimeOptions['storageAdapter'];
  signal?: AbortSignal;
  onDisconnect?: (error: Error) => void;
}

export async function connectConversationWorkspace(options: WorkspaceConnectionOptions) {
  const fetch = cloudFetch();
  const jwt = new BetterAuthConvexJwtProvider({
    authOrigin: options.authOrigin,
    getSessionBearer: async () => options.token,
    fetch,
  });
  const directory = new ConvexCloudDirectory({ convexUrl: options.convexUrl, jwt, fetch });
  if (new Set(['chrome-extension:', 'moz-extension:']).has(location.protocol)) {
    const remote = await connectBackgroundWorkspace(
      {
        accountId: options.accountId,
        workspaceId: options.workspaceId,
        accountKey: JSON.stringify([
          workspaceScope(
            options.authOrigin,
            productConfig.clientId,
            options.accountId,
            options.workspaceId,
          ),
          new URL(options.convexUrl).origin,
        ]),
        authOrigin: options.authOrigin,
        convexUrl: options.convexUrl,
        token: options.token,
      },
      options.signal ?? new AbortController().signal,
      (error) => options.onDisconnect?.(error),
    );
    return { ...remote.connection, directory };
  }
  const grant = await options.client.streams.getGrant(options.token, options.workspaceId);
  if (!grant.gatewayBaseUrl) throw new Error('Streams grant did not provide a gateway URL.');
  let currentGrant = grant;
  let expiresAt = Date.now() + grant.expiresIn * 1000;
  const auth: LoroRuntimeOptions['auth'] = async () => {
    if (Date.now() >= expiresAt - 10_000) {
      currentGrant = await options.client.streams.getGrant(options.token, options.workspaceId);
      expiresAt = Date.now() + currentGrant.expiresIn * 1000;
      if (currentGrant.gatewayBaseUrl !== grant.gatewayBaseUrl)
        throw new Error('Streams gateway changed. Reconnect the workspace.');
    }
    return currentGrant.token;
  };
  const commands = new StreamsMachineCommands({
    workspaceId: options.workspaceId,
    streams: new JsonRpcStreams({ baseUrl: grant.gatewayBaseUrl, auth }),
  });
  await initializeLoroWasm();
  options.signal?.throwIfAborted();
  const connection = await createLoroSessionRuntime({
    workspaceId: options.workspaceId,
    streamsBaseUrl: grant.gatewayBaseUrl,
    auth,
    commands,
    storageAdapter: options.storageAdapter,
    documentRemoteCursorStore: createDocumentCursorStore(
      JSON.stringify([options.authOrigin, options.accountId, options.workspaceId]),
    ),
  });
  return { ...connection, directory };
}
