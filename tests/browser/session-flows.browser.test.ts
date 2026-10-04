import type { SendTurn, SessionMetadata, SessionSnapshot } from '@lody-mobile/sdk';
import { SessionRuntime } from '@lody-mobile/sdk';
import { expect, it } from 'vitest';

import {
  refreshMachineCapabilities,
  SessionAdmissionError,
  startSession,
  steerTurn,
} from '../../src/features/conversations/session-flows';

const metadata: SessionMetadata = {
  id: 'session',
  machineId: 'machine',
  userId: 'user',
  createdAt: '2026-10-03T00:00:00Z',
  isArchived: false,
};
const input: SendTurn = {
  requestId: 'turn',
  timestamp: metadata.createdAt,
  userId: 'user',
  inputConfig: { prompt: 'Hello', cliType: 'builtin', agentType: 'codex' },
};

function fixture(
  replies: Array<{ applied: boolean; disposition: string; recoveryOwned?: boolean }> = [],
) {
  const events: string[] = [];
  const requests: Array<{ requestId: string; params: Record<string, unknown> }> = [];
  const snapshot: SessionSnapshot = { sessionId: metadata.id, history: [], queue: [], session: {} };
  const repository = {
    create: async (_meta: SessionMetadata) => {
      events.push('create');
    },
    list: async () => [metadata],
    patch: async () => {},
    subscribe: () => () => {},
    close: async () => {},
    open: async () => ({
      read: () => snapshot,
      subscribe: () => () => {},
      append: async (turn: SendTurn, kind: string) => {
        events.push(`append:${kind}:${turn.requestId}`);
      },
      respondPermission: async () => {},
      promote: async (turnId: string) => {
        events.push(`promote:${turnId}`);
      },
      flush: async () => {
        events.push('flush');
      },
      close: async () => {
        events.push('close');
      },
    }),
  };
  const runtime = new SessionRuntime(repository, {
    request: async (_machine, method, params, requestId) => {
      events.push(method);
      requests.push({ requestId, params });
      return replies.shift();
    },
  });
  return { runtime, repository, events, requests, snapshot };
}

for (const stage of ['metadata', 'turn'] as const) {
  it(`application admission retains identity after a ${stage} failure and resumes the same submission`, async () => {
    const { runtime, repository } = fixture();
    const observed: string[] = [];
    let failed = true;
    const create = repository.create;
    repository.create = async (meta) => {
      observed.push(meta.id);
      if (stage === 'metadata' && failed) throw new Error('offline');
      await create(meta);
    };
    const open = repository.open;
    repository.open = async () => {
      const handle = await open();
      return {
        ...handle,
        append: async (turn, kind) => {
          observed.push(turn.requestId);
          if (stage === 'turn' && failed) throw new Error('offline');
          await handle.append(turn, kind);
        },
      };
    };
    const failure = await startSession(runtime, metadata, input).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SessionAdmissionError);
    if (!(failure instanceof SessionAdmissionError)) throw new Error('Expected admission failure');
    expect(failure.admission.state).toBe(
      stage === 'metadata' ? 'metadata-unconfirmed' : 'metadata-synced',
    );
    expect(failure.admission.input).toEqual(input);
    failed = false;
    const result = await startSession(runtime, failure.admission.metadata, failure.admission.input);
    expect(result.state).toBe('synced');
    expect(observed).toEqual(
      stage === 'metadata'
        ? ['session', 'session', 'turn']
        : ['session', 'turn', 'session', 'turn'],
    );
  });
}

it('application steering persists the guide before RPC and owns promotion to a queued turn', async () => {
  const { runtime, events } = fixture([{ applied: false, disposition: 'no-active-turn' }]);
  const result = await steerTurn(runtime, 'machine', 'session', 'active', input);
  expect(result.state).toBe('queued');
  expect(events).toEqual(['append:guide:turn', 'flush', 'session/steer', 'promote:turn', 'close']);
});

it('application steering retries remote promotion once with the same request identity', async () => {
  const { runtime, requests, events } = fixture([
    { applied: false, disposition: 'promotion-failed', recoveryOwned: true },
    { applied: true, disposition: 'applied' },
  ]);
  expect((await steerTurn(runtime, 'machine', 'session', 'active', input)).state).toBe('applied');
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]?.requestId).toBe(input.requestId);
  expect(events.filter((event) => event.startsWith('append:'))).toHaveLength(1);
  expect(events.at(-1)).toBe('close');
});

it('application steering reconciles remote recovery against history and keeps uncertainty visible', async () => {
  for (const recovered of [false, true]) {
    const { runtime, snapshot, events } = fixture([
      { applied: false, disposition: 'busy', recoveryOwned: true },
    ]);
    if (recovered)
      snapshot.history.push({
        id: input.requestId,
        role: 'user',
        timestamp: input.timestamp,
        status: 'pending',
      });
    const result = steerTurn(runtime, 'machine', 'session', 'active', input);
    if (recovered) expect((await result).state).toBe('recovered');
    else await expect(result).rejects.toThrow('steer_delivery_uncertain');
    expect(events.at(-1)).toBe('close');
    expect(events.some((event) => event.startsWith('promote:'))).toBe(false);
  }
});

it('cancelled application steering does not persist a guide or issue a command', async () => {
  const { runtime, events } = fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    steerTurn(runtime, 'machine', 'session', 'active', input, controller.signal),
  ).rejects.toThrow();
  expect(events).toEqual([]);
});

it('capability refresh exposes terminal application failures and performs no retry', async () => {
  const { runtime } = fixture();
  let calls = 0;
  runtime.refreshCapabilities = async () => {
    calls++;
    return { success: false, error: 'authentication required' };
  };
  await expect(refreshMachineCapabilities(runtime, 'machine', 'agent', 'request')).rejects.toThrow(
    'authentication required',
  );
  expect(calls).toBe(1);
  runtime.refreshCapabilities = async () => ({ success: true });
  await expect(
    refreshMachineCapabilities(runtime, 'machine', 'agent', 'request'),
  ).resolves.toBeUndefined();
});
