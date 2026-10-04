import type { SessionHandle, SessionSnapshot } from '@lody-mobile/sdk';
import { SessionRuntime } from '@lody-mobile/sdk';
import { expect, it } from 'vitest';

import { ConversationRuntimeController } from '../../src/features/conversations/runtime-controller';

const snapshot: SessionSnapshot = { sessionId: 'session-a', history: [], queue: [], session: {} };

it('closes an old connection and fences late history events after switching workspaces', async () => {
  let listener: ((snapshot: SessionSnapshot) => void) | null = null;
  let closes = 0;
  const handle: SessionHandle = {
    read: () => snapshot,
    subscribe: (next) => {
      listener = next;
      return () => {};
    },
    respondPermission: async () => {},
    promote: async () => {},
    append: async () => {},
    flush: async () => {},
    close: async () => {
      ++closes;
    },
  };
  const runtime = new SessionRuntime(
    {
      list: async () => [
        {
          id: 'session-a',
          machineId: 'machine',
          userId: 'user',
          createdAt: '2026-10-03',
          isArchived: false,
        },
      ],
      subscribe: () => () => {},
      open: async () => handle,
      create: async () => {},
      patch: async () => {},
      close: async () => {},
    },
    { request: async () => null },
  );
  const controller = new ConversationRuntimeController();
  await controller.connect(async () => ({
    runtime,
    close: async () => {
      ++closes;
    },
  }));
  await controller.open('session-a');
  expect(controller.getSnapshot().snapshot?.sessionId).toBe('session-a');
  await controller.disconnect();
  const emit: (snapshot: SessionSnapshot) => void = listener ?? (() => {});
  emit({ ...snapshot, history: [{ id: 'late', role: 'assistant', timestamp: 'now' }] });
  expect(controller.getSnapshot().snapshot).toBeNull();
  expect(controller.getSnapshot().sessions).toEqual([]);
  expect(closes).toBe(2);
});

it('closes a connection that finishes opening after its identity has been invalidated', async () => {
  let release: (() => void) | null = null;
  let closed = false;
  let started = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = new SessionRuntime(
    {
      list: async () => [],
      subscribe: () => () => {},
      open: async () => {
        throw new Error('unused');
      },
      create: async () => {},
      patch: async () => {},
      close: async () => {},
    },
    { request: async () => null },
  );
  const controller = new ConversationRuntimeController();
  const opening = controller.connect(async () => {
    started = true;
    await gate;
    return {
      runtime,
      close: async () => {
        closed = true;
      },
    };
  });
  await expect.poll(() => started).toBe(true);
  await controller.disconnect();
  const resolve: () => void = release ?? (() => {});
  resolve();
  await opening;
  expect(controller.getSnapshot().status).toBe('disconnected');
  expect(closed).toBe(true);
});

it('keeps an uncertain turn across reload and confirms history without sending it twice', async () => {
  const { TurnJournal } = await import('../../src/features/conversations/turn-journal');
  const journal = new TurnJournal('runtime-test');
  await journal.clear();
  let appends = 0;
  const history: SessionSnapshot['history'] = [];
  const handle: SessionHandle = {
    read: () => ({ ...snapshot, history }),
    subscribe: () => () => {},
    append: async (input) => {
      ++appends;
      history.push({
        id: input.requestId,
        role: 'user',
        timestamp: input.timestamp,
        userId: input.userId,
      });
      throw new Error('lost acknowledgement');
    },
    respondPermission: async () => {},
    promote: async () => {},
    flush: async () => {},
    close: async () => {},
  };
  const runtime = new SessionRuntime(
    {
      list: async () => [
        {
          id: 'session-a',
          machineId: 'machine',
          userId: 'user',
          createdAt: 'now',
          latestUserMsgId: 'stable-turn',
          isArchived: false,
        },
      ],
      open: async () => handle,
      subscribe: () => () => {},
      create: async () => {},
      patch: async () => {},
      close: async () => {},
    },
    { request: async () => null },
  );
  const first = new ConversationRuntimeController(journal);
  await first.connect(async () => ({ runtime, close: async () => {} }));
  await first.open('session-a');
  await first.send(
    {
      requestId: 'stable-turn',
      timestamp: new Date().toISOString(),
      userId: 'user',
      inputConfig: { prompt: 'hello', cliType: 'builtin', agentType: 'codex' },
    },
    'dispatch',
  );
  expect(journal.load()?.input.requestId).toBe('stable-turn');
  await first.disconnect();
  const reopened = new ConversationRuntimeController(journal);
  await reopened.connect(async () => ({ runtime, close: async () => {} }));
  expect(appends).toBe(1);
  expect(journal.load()).toBeNull();
  expect(reopened.getSnapshot().snapshot?.history[0]?.id).toBe('stable-turn');
  await reopened.disconnect();
});

it('rejects unfinished forks and edits by another user, and sends exact source and replacement IDs', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const history: SessionSnapshot['history'] = [
    { id: 'unfinished', role: 'assistant', timestamp: 'now', finished: false },
    { id: 'finished', role: 'assistant', timestamp: 'now', finished: true },
    { id: 'source-user', role: 'user', userId: 'owner', timestamp: 'now' },
  ];
  const handle: SessionHandle = {
    read: () => ({ ...snapshot, history }),
    subscribe: () => () => {},
    append: async () => {},
    flush: async () => {},
    close: async () => {},
    respondPermission: async () => {},
    promote: async () => {},
  };
  const runtime = new SessionRuntime(
    {
      list: async () => [
        {
          id: 'session-a',
          machineId: 'machine',
          userId: 'owner',
          createdAt: 'now',
          isArchived: false,
        },
      ],
      open: async () => handle,
      subscribe: () => () => {},
      create: async () => {},
      patch: async () => {},
      close: async () => {},
    },
    {
      request: async (_machine, method, params) => {
        calls.push({ method, params });
        return {};
      },
    },
  );
  const controller = new ConversationRuntimeController();
  await controller.connect(async () => ({ runtime, close: async () => {} }));
  await controller.open('session-a');
  await controller.forkTurn('unfinished', 'owner');
  const input = {
    requestId: 'replacement',
    timestamp: new Date().toISOString(),
    userId: 'other',
    inputConfig: { prompt: 'edit', cliType: 'builtin' as const, agentType: 'codex' },
  };
  await controller.editTurn('source-user', input);
  expect(calls).toHaveLength(0);
  await controller.editTurn('source-user', { ...input, userId: 'owner' });
  expect(calls[0]?.method).toBe('session/edit-and-resend');
  expect(calls[0]?.params.expectedUserTurnId).toBe('source-user');
  expect(calls[0]?.params.replacementUserTurnId).toBe('replacement');
  await controller.forkTurn('finished', 'owner');
  expect(calls[1]?.method).toBe('session/fork');
  expect(calls[1]?.params.sourceTurnId).toBe('finished');
  expect(calls[1]?.params.sourceSessionId).toBe('session-a');
  expect(calls[1]?.params.targetContext).toEqual({ kind: 'shared' });
  await controller.disconnect();
});
