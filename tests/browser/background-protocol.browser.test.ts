import type { ScheduleDraft, SendTurn } from '@lody-mobile/sdk';
import * as v from 'valibot';
import { expect, it } from 'vitest';

import type { WorkspaceMethods } from '../../src/features/connection/background-protocol';
import {
  parseWorkspaceArgs,
  workspaceMethods,
  workspaceRequestSchema,
} from '../../src/features/connection/background-protocol';

const turn: SendTurn = {
  requestId: 'turn-1',
  userId: 'user-1',
  timestamp: '2026-10-05T00:00:00Z',
  inputConfig: { prompt: 'Summarize this page', cliType: 'builtin', agentType: 'codex' },
};
const draft: ScheduleDraft = {
  title: 'Daily summary',
  machineId: 'machine-1',
  trigger: { kind: 'manual' },
  misfirePolicy: { kind: 'skip' },
  overlapPolicy: 'skip',
  agent: { agentConfigId: 'agent-1' },
  retryPolicy: { dispatchMaxAttempts: 1, dispatchMaxAgeMs: 60_000 },
  prompt: 'Summarize recent activity',
};
const identity = {
  accountId: 'user-1',
  workspaceId: 'workspace-1',
  authOrigin: 'https://auth.example.test',
  token: 'scoped-token',
  convexUrl: 'https://cloud.example.test',
  accountKey: 'account-scope',
};
const valid = {
  bootstrap: [identity],
  'repository.create': [
    {
      id: 'session-1',
      machineId: 'machine-1',
      userId: 'user-1',
      createdAt: turn.timestamp,
      isArchived: false,
    },
  ],
  'repository.list': [],
  'repository.patch': ['session-1', { title: 'Renamed conversation' }],
  'repository.open': ['session-1', 'lease-1'],
  'session.append': ['lease-1', turn, 'dispatch'],
  'session.respondPermission': [
    'lease-1',
    'turn-1',
    'request-1',
    { outcome: 'selected', optionId: 'allow' },
  ],
  'session.promote': ['lease-1', 'turn-1'],
  'session.flush': ['lease-1'],
  'session.close': ['lease-1'],
  'machines.list': [['machine-1']],
  'machines.open': ['machine-1', 'lease-1'],
  'machine.archive': ['lease-1', 'session-1', 'user-1'],
  'machine.delete': ['lease-1', 'session-1'],
  'machine.close': ['lease-1'],
  'schedules.list': [],
  'schedules.read': ['schedule-1'],
  'schedules.runtimeRows': [],
  'schedules.save': [
    {
      scheduleId: 'schedule-1',
      draft,
      actorId: 'user-1',
      now: 1,
      activationId: 'activation-1',
      activityId: 'activity-1',
      create: true,
    },
  ],
  'schedules.setEnabled': [
    {
      scheduleId: 'schedule-1',
      actorId: 'user-1',
      enabled: true,
      now: 1,
      activationId: 'activation-1',
      requestId: 'request-1',
    },
  ],
  'schedules.requestRun': [
    { scheduleId: 'schedule-1', actorId: 'user-1', manualRunId: 'run-1', now: 1 },
  ],
  'schedules.delete': ['schedule-1', 'user-1', 1],
  'mcp.list': [],
  'commands.request': [
    'machine-1',
    'session/cancel',
    { sessionId: 'session-1', turnId: 'turn-1' },
    'request-1',
  ],
} satisfies { [K in keyof WorkspaceMethods]: Parameters<WorkspaceMethods[K]> };

it.each(workspaceMethods.map((method) => ({ method, args: valid[method] })))(
  'preserves $method arguments and rejects changed arity',
  ({ method, args }) => {
    expect(parseWorkspaceArgs(method, args)).toEqual(args);
    expect(() => parseWorkspaceArgs(method, [...args, 'unexpected'])).toThrow();
    if (args.length) expect(() => parseWorkspaceArgs(method, args.slice(1))).toThrow();
  },
);

it('rejects missing or malformed resource identities before a metadata mutation', () => {
  for (const id of [undefined, null, '', 42, {}, ['session-1']]) {
    expect(() => parseWorkspaceArgs('repository.patch', [id, { title: 'Updated' }])).toThrow();
    expect(() => parseWorkspaceArgs('session.flush', [id])).toThrow();
  }
});

it('rejects array-shaped objects before record decoding can turn them into valid empty patches', () => {
  for (const object of [[], [{ title: 'Unexpected array' }], null, 'text', 1]) {
    expect(() => parseWorkspaceArgs('repository.patch', ['session-1', object])).toThrow();
    expect(() => parseWorkspaceArgs('session.append', ['lease-1', object, 'dispatch'])).toThrow();
    expect(() => parseWorkspaceArgs('schedules.save', [object])).toThrow();
    expect(() =>
      parseWorkspaceArgs('commands.request', ['machine-1', 'session/cancel', object, 'request-1']),
    ).toThrow();
  }
});

it('rejects unknown operations, invalid dispatch modes and incomplete permission decisions', () => {
  expect(
    v.safeParse(workspaceRequestSchema, {
      type: 'call',
      id: 'rpc-1',
      method: 'repository.destroy',
      args: [],
    }).success,
  ).toBe(false);
  expect(() =>
    parseWorkspaceArgs('commands.request', ['machine-1', 'unknown/execute', {}, 'request-1']),
  ).toThrow();
  expect(() => parseWorkspaceArgs('session.append', ['lease-1', turn, 'send'])).toThrow();
  expect(() =>
    parseWorkspaceArgs('session.respondPermission', [
      'lease-1',
      'turn-1',
      'request-1',
      { outcome: 'selected' },
    ]),
  ).toThrow();
  expect(
    parseWorkspaceArgs('session.respondPermission', [
      'lease-1',
      'turn-1',
      'request-1',
      { outcome: 'cancelled' },
    ]),
  ).toEqual(['lease-1', 'turn-1', 'request-1', { outcome: 'cancelled' }]);
});

it('rejects altered handshake fields and credentials embedded in an origin', () => {
  for (const altered of [
    { ...identity, unexpected: true },
    { ...identity, token: 'token with spaces' },
    { ...identity, authOrigin: 'http://auth.example.test' },
    { ...identity, authOrigin: 'https://user:password@auth.example.test' },
    { ...identity, convexUrl: 'https://cloud.example.test/api' },
  ])
    expect(() => parseWorkspaceArgs('bootstrap', [altered])).toThrow();
});
