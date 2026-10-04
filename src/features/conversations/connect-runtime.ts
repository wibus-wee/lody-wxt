import type { LodyClient } from '@lody-mobile/sdk';
import {
  BetterAuthConvexJwtProvider,
  ConvexCloudDirectory,
  StreamsMachineCommands,
} from '@lody-mobile/sdk';
import type { LoroRuntimeOptions } from '@lody-mobile/sdk/loro';
import { createLoroSessionRuntime } from '@lody-mobile/sdk/loro';
import { JsonRpcStreams } from '@lody-mobile/sdk/rpc';

import { createDocumentCursorStore } from './runtime-storage';

export interface WorkspaceConnectionOptions {
  accountId: string;
  workspaceId: string;
  token: string;
  authOrigin: string;
  convexUrl: string;
  client: LodyClient;
  storageAdapter: LoroRuntimeOptions['storageAdapter'];
}

export async function connectConversationWorkspace(options: WorkspaceConnectionOptions) {
  const jwt = new BetterAuthConvexJwtProvider({
    authOrigin: options.authOrigin,
    getSessionBearer: async () => options.token,
  });
  const directory = new ConvexCloudDirectory({ convexUrl: options.convexUrl, jwt });
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
