import type {
  MachineCommandPort,
  ScheduleRepository,
  SessionHandle,
  SessionRepository,
} from '@lody-mobile/sdk';
import type { createLoroSessionRuntime } from '@lody-mobile/sdk/loro';
import * as v from 'valibot';

export const workspacePort = 'lody:workspace';
const id = v.pipe(v.string(), v.minLength(1));
const origin = v.pipe(
  v.string(),
  v.url(),
  v.check((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  }),
);
export const workspaceIdentitySchema = v.strictObject({
  accountId: id,
  workspaceId: id,
  authOrigin: origin,
  token: v.pipe(id, v.regex(/^\S+$/)),
  convexUrl: origin,
  accountKey: id,
});
export type WorkspaceIdentity = v.InferOutput<typeof workspaceIdentitySchema>;
type Runtime = Awaited<ReturnType<typeof createLoroSessionRuntime>>;
export type RemoteMachine = Awaited<ReturnType<Runtime['machines']['open']>>;
export type MachineSnapshot = ReturnType<RemoteMachine['read']>;
export interface WorkspaceBootstrap {
  gatewayOrigin: string;
  machineIds: string[];
}
export interface WorkspaceMethods {
  bootstrap: (identity: WorkspaceIdentity) => Promise<WorkspaceBootstrap>;
  'repository.create': SessionRepository['create'];
  'repository.list': SessionRepository['list'];
  'repository.patch': SessionRepository['patch'];
  'repository.open': (
    sessionId: string,
    leaseId: string,
  ) => Promise<ReturnType<SessionHandle['read']>>;
  'session.append': (
    leaseId: string,
    ...args: Parameters<SessionHandle['append']>
  ) => Promise<void>;
  'session.respondPermission': (
    leaseId: string,
    ...args: Parameters<SessionHandle['respondPermission']>
  ) => Promise<void>;
  'session.promote': (
    leaseId: string,
    ...args: Parameters<SessionHandle['promote']>
  ) => Promise<void>;
  'session.flush': (leaseId: string) => Promise<ReturnType<SessionHandle['read']>>;
  'session.close': (leaseId: string) => Promise<void>;
  'machines.list': Runtime['machines']['listMachineInfos'];
  'machines.open': (machineId: string, leaseId: string) => Promise<MachineSnapshot>;
  'machine.archive': (
    leaseId: string,
    ...args: Parameters<RemoteMachine['archiveSession']>
  ) => Promise<void>;
  'machine.delete': (
    leaseId: string,
    ...args: Parameters<RemoteMachine['deleteSession']>
  ) => Promise<void>;
  'machine.close': (leaseId: string) => Promise<void>;
  'schedules.list': ScheduleRepository['list'];
  'schedules.read': ScheduleRepository['read'];
  'schedules.runtimeRows': ScheduleRepository['runtimeRows'];
  'schedules.save': ScheduleRepository['save'];
  'schedules.setEnabled': ScheduleRepository['setEnabled'];
  'schedules.requestRun': ScheduleRepository['requestRun'];
  'schedules.delete': ScheduleRepository['delete'];
  'mcp.list': Runtime['mcpCatalog']['list'];
  'commands.request': (
    ...args: [machineId: string, method: string, params: Record<string, unknown>, requestId: string]
  ) => ReturnType<MachineCommandPort['request']>;
}
export const workspaceMethods = [
  'bootstrap',
  'repository.create',
  'repository.list',
  'repository.patch',
  'repository.open',
  'session.append',
  'session.respondPermission',
  'session.promote',
  'session.flush',
  'session.close',
  'machines.list',
  'machines.open',
  'machine.archive',
  'machine.delete',
  'machine.close',
  'schedules.list',
  'schedules.read',
  'schedules.runtimeRows',
  'schedules.save',
  'schedules.setEnabled',
  'schedules.requestRun',
  'schedules.delete',
  'mcp.list',
  'commands.request',
] as const satisfies readonly (keyof WorkspaceMethods)[];
const record = v.pipe(
  v.unknown(),
  v.check((value) => !Array.isArray(value)),
  v.record(v.string(), v.unknown()),
);
const timestamp = v.pipe(v.number(), v.finite(), v.minValue(0));
const command = v.picklist([
  'session/cancel',
  'session/steer',
  'machine/acp-capabilities-refresh',
  'session/fork',
  'session/edit-and-resend',
  'local-project/control',
]);
const permissionOutcome = v.variant('outcome', [
  v.strictObject({ outcome: v.literal('cancelled') }),
  v.strictObject({ outcome: v.literal('selected'), optionId: id }),
]);
// This boundary validates routing and arguments; the SDK owns each document's domain schema.
const workspaceArgs = {
  bootstrap: v.strictTuple([workspaceIdentitySchema]),
  'repository.create': v.strictTuple([record]),
  'repository.list': v.strictTuple([]),
  'repository.patch': v.strictTuple([id, record]),
  'repository.open': v.strictTuple([id, id]),
  'session.append': v.strictTuple([id, record, v.picklist(['dispatch', 'queue', 'guide'])]),
  'session.respondPermission': v.strictTuple([id, id, id, permissionOutcome]),
  'session.promote': v.strictTuple([id, id]),
  'session.flush': v.strictTuple([id]),
  'session.close': v.strictTuple([id]),
  'machines.list': v.strictTuple([v.array(id)]),
  'machines.open': v.strictTuple([id, id]),
  'machine.archive': v.strictTuple([id, id, id]),
  'machine.delete': v.strictTuple([id, id]),
  'machine.close': v.strictTuple([id]),
  'schedules.list': v.strictTuple([]),
  'schedules.read': v.strictTuple([id]),
  'schedules.runtimeRows': v.strictTuple([]),
  'schedules.save': v.strictTuple([record]),
  'schedules.setEnabled': v.strictTuple([record]),
  'schedules.requestRun': v.strictTuple([record]),
  'schedules.delete': v.strictTuple([id, id, timestamp]),
  'mcp.list': v.strictTuple([]),
  'commands.request': v.strictTuple([id, command, record, id]),
} satisfies Record<keyof WorkspaceMethods, v.GenericSchema>;

export function parseWorkspaceArgs(method: keyof WorkspaceMethods, args: unknown[]) {
  return v.parse(workspaceArgs[method], args);
}

export const workspaceRequestSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('call'),
    id,
    method: v.picklist(workspaceMethods),
    args: v.array(v.unknown()),
  }),
  v.strictObject({ type: v.literal('cancel'), id }),
]);
const error = v.object({ name: v.string(), message: v.string() });
export const workspaceReplySchema = v.variant('type', [
  v.strictObject({ type: v.literal('result'), id, value: v.unknown() }),
  v.strictObject({ type: v.literal('error'), id, error }),
  v.strictObject({ type: v.literal('sessions-changed') }),
  v.strictObject({ type: v.literal('machines-changed') }),
  v.strictObject({ type: v.literal('session'), leaseId: id, snapshot: v.unknown() }),
  v.strictObject({ type: v.literal('session-error'), leaseId: id, error }),
  v.strictObject({ type: v.literal('machine'), leaseId: id, snapshot: v.unknown() }),
  v.strictObject({ type: v.literal('fatal'), error }),
]);
export type WorkspaceReply = v.InferOutput<typeof workspaceReplySchema>;
