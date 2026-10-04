import type { SessionMetadata, SessionSnapshot } from '@lody-mobile/sdk';
import { createLodyClient, StreamsMachineCommands } from '@lody-mobile/sdk';
import { createLoroSessionRuntime } from '@lody-mobile/sdk/loro';
import { JsonRpcStreams } from '@lody-mobile/sdk/rpc';
import { IndexedDBStorageAdaptor } from 'loro-repo/storage/indexeddb';
import * as v from 'valibot';
import { initializeWorkerWasm } from 'virtual:lody-worker-wasm';

import type { StoredSession } from '../account/model';
import { requireApiAccess } from '../connection/state';
import type { NotificationState, Observation } from './model';

const statusSchema = v.object({
  type: v.picklist(['idle', 'running', 'requestPermission', 'initializing']),
});
export function observeMetadata(metadata: SessionMetadata): Observation {
  return {
    status: metadata.status === undefined ? 'unknown' : v.parse(statusSchema, metadata.status).type,
    activity:
      metadata.lastMessageAt === undefined
        ? 0
        : v.parse(v.pipe(v.number(), v.finite()), metadata.lastMessageAt),
    userTurn: metadata.latestUserMsgId ?? '',
  };
}
export function changedObservation(previous: Observation, next: Observation) {
  return (
    previous.status !== next.status ||
    previous.activity !== next.activity ||
    previous.userTurn !== next.userTurn
  );
}
export function terminalEvent(snapshot: SessionSnapshot, expectedUserTurn: string) {
  const lastUser = snapshot.history.findLastIndex((turn) => turn.role === 'user');
  if (expectedUserTurn && snapshot.history[lastUser]?.id !== expectedUserTurn) return null;
  const assistant = snapshot.history
    .slice(lastUser + 1)
    .findLast((turn) => turn.role === 'assistant');
  if (!assistant) return null;
  if (new Set(['canceled', 'cancelled', 'stopped']).has(assistant.status ?? '')) return null;
  if (new Set(['failed', 'error']).has(assistant.status ?? ''))
    return { kind: 'failed' as const, turnId: assistant.id };
  if (assistant.finished === true) return { kind: 'completed' as const, turnId: assistant.id };
  return null;
}
const pendingPermissionSchema = v.object({
  type: v.literal('tool_call'),
  permissionRequest: v.object({ requestId: v.string(), outcome: v.exactOptional(v.unknown()) }),
});
export function pendingPermissionIds(snapshot: SessionSnapshot, expectedUserTurn: string) {
  const lastUser = snapshot.history.findLastIndex((turn) => turn.role === 'user');
  if (expectedUserTurn && snapshot.history[lastUser]?.id !== expectedUserTurn) return [];
  return snapshot.history.slice(lastUser + 1).flatMap((turn) =>
    (turn.items ?? []).flatMap((item) => {
      const result = v.safeParse(pendingPermissionSchema, item);
      return result.success && result.output.permissionRequest.outcome === undefined
        ? [result.output.permissionRequest.requestId]
        : [];
    }),
  );
}
export async function connectNotificationObserver(
  session: StoredSession,
  state: NotificationState,
  signal: AbortSignal,
) {
  await initializeWorkerWasm();
  signal.throwIfAborted();
  if (!session.workspaceId) throw new Error('请先选择工作区。');
  await requireApiAccess(session.config.authOrigin);
  const client = createLodyClient({ ...session.config, requestTimeoutMs: 10_000 });
  const grant = await client.streams.getGrant(session.token.access_token, session.workspaceId, {
    signal,
  });
  if (!grant.gatewayBaseUrl) throw new Error('Streams grant did not provide a gateway URL.');
  if (grant.expiresIn < 30)
    throw new Error('Streams grant expires before the notification read can finish.');
  await requireApiAccess(new URL(grant.gatewayBaseUrl).origin);
  signal.throwIfAborted();
  // The grant outlives this 20-second read lease; this observer never sends commands.
  const auth = async () => grant.token;
  return createLoroSessionRuntime({
    workspaceId: session.workspaceId,
    streamsBaseUrl: grant.gatewayBaseUrl,
    auth,
    storageAdapter: new IndexedDBStorageAdaptor({
      dbName: `lody:notification-repo:${state.scope}`,
      durability: 'strict',
    }),
    documentRemoteCursorStore: {
      load: async () => null,
      save: async () => {},
      delete: async () => {},
    },
    commands: new StreamsMachineCommands({
      workspaceId: session.workspaceId,
      streams: new JsonRpcStreams({ baseUrl: grant.gatewayBaseUrl, auth }),
    }),
    signal,
    timeoutMs: 15_000,
  });
}
