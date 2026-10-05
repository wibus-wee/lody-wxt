import assert from 'node:assert/strict';
import test from 'node:test';

import { LoroDoc, LoroList, LoroMap } from 'loro-crdt';

import { SessionRuntime, StreamsMachineCommands } from '../dist/index.js';
import { LoroSessionRepository } from '../dist/sessions/infrastructure/loro-session-repository.js';

function repositoryFixture(failure) {
  const doc = new LoroDoc();
  const events = [];
  let fail = true;
  const step = async (name) => {
    events.push(name);
    if (fail && failure === name) {
      fail = false;
      throw new Error('injected_failure');
    }
  };
  const repository = new LoroSessionRepository({
    repo: {
      acquireDoc: async () => ({ doc, release: async () => {} }),
      joinDocRoom: async () => ({
        firstSyncedWithRemote: Promise.resolve(),
        waitUntilSynced: () => step('history-sync'),
        unsubscribe() {},
      }),
      persistDocNow: () => step('history-persist'),
      getDocMeta: async () => null,
      upsertDocMeta: () => step('dispatch'),
      persistMetaNow: () => step('metadata-persist'),
    },
    metaRoom: { waitUntilSynced: () => step('metadata-sync') },
  });
  return { doc, events, repository, runtime: new SessionRuntime(repository, {}) };
}

for (const failure of ['history-persist', 'history-sync']) {
  test(`dispatch retry after ${failure} failure confirms history before publishing metadata`, async () => {
    const { runtime, repository, doc, events } = repositoryFixture(failure);
    const input = {
      requestId: 'turn',
      timestamp: '2026-10-03T00:00:00Z',
      userId: 'user',
      inputConfig: { prompt: 'Hello', cliType: 'builtin', agentType: 'codex' },
    };
    try {
      await assert.rejects(runtime.send('session', input), /injected_failure/);
      assert.ok(!events.includes('dispatch'));
      events.length = 0;
      assert.equal((await runtime.send('session', input)).state, 'synced');
      assert.deepEqual(events.slice(0, 3), ['history-persist', 'history-sync', 'dispatch']);
      assert.equal(doc.toJSON().history.length, 1);
      assert.equal(doc.toJSON().history[0].id, input.requestId);
    } finally {
      await repository.close();
    }
  });

  test(`permission retry after ${failure} failure persists and synchronizes the existing outcome`, async () => {
    const { runtime, repository, doc, events } = repositoryFixture(failure);
    const turn = doc.getList('history').insertContainer(0, new LoroMap());
    turn.set('id', 'assistant');
    turn.set('role', 'assistant');
    turn.set('timestamp', '2026-10-03T00:00:00Z');
    const item = turn.setContainer('items', new LoroList()).insertContainer(0, new LoroMap());
    item.set('type', 'tool_call');
    const request = item.setContainer('permissionRequest', new LoroMap());
    request.set('requestId', 'permission');
    request
      .setContainer('options', new LoroList())
      .insertContainer(0, new LoroMap())
      .set('optionId', 'allow');
    doc.commit();
    const outcome = { outcome: 'selected', optionId: 'allow' };
    try {
      await assert.rejects(
        runtime.respondPermission('session', 'assistant', 'permission', outcome),
        /injected_failure/,
      );
      events.length = 0;
      await runtime.respondPermission('session', 'assistant', 'permission', outcome);
      assert.deepEqual(events, ['history-persist', 'history-sync']);
      assert.deepEqual(request.toJSON().outcome, outcome);
      await assert.rejects(
        runtime.respondPermission('session', 'assistant', 'permission', { outcome: 'cancelled' }),
        /permission_already_resolved/,
      );
    } finally {
      await repository.close();
    }
  });
}

test('SDK steering issues one command and leaves document writes and recovery to the caller', async () => {
  const requests = [];
  const verdict = { applied: false, disposition: 'promotion-failed', recoveryOwned: true };
  const runtime = new SessionRuntime(
    {
      open: async () => {
        throw new Error('unexpected document write');
      },
    },
    {
      request: async (...args) => {
        requests.push(args);
        return verdict;
      },
    },
  );
  const input = {
    requestId: 'guide',
    timestamp: '2026-10-03T00:00:00Z',
    userId: 'user',
    inputConfig: { prompt: 'Hello', cliType: 'builtin', agentType: 'codex' },
  };
  assert.equal(await runtime.steer('machine', 'session', 'active', input), verdict);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][1], 'session/steer');
  assert.equal(requests[0][3], input.requestId);
});

const commandCases = [
  {
    method: 'session/cancel',
    params: { sessionId: 'session', turnId: 'turn' },
    result: { type: 'session/cancel_response', sessionId: 'session', success: true },
    identities: ['sessionId'],
  },
  {
    method: 'session/steer',
    params: {
      sessionId: 'session',
      expectedTurnId: 'active',
      userTurnId: 'turn',
      userId: 'user',
      timestamp: 'now',
      inputConfig: {},
    },
    result: {
      type: 'session/steer_response',
      sessionId: 'session',
      userTurnId: 'turn',
      applied: true,
      disposition: 'applied',
    },
    identities: ['sessionId', 'userTurnId'],
  },
  {
    method: 'session/dispatch-turn',
    params: {
      sessionId: 'session',
      userTurnId: 'turn',
      userId: 'user',
      timestamp: 'now',
      inputConfig: {},
    },
    result: {
      type: 'session/dispatch-turn_response',
      sessionId: 'session',
      userTurnId: 'turn',
      accepted: true,
      disposition: 'accepted',
    },
    identities: ['sessionId', 'userTurnId'],
  },
  {
    method: 'session/edit-and-resend',
    params: {
      sessionId: 'session',
      expectedUserTurnId: 'previous',
      replacementUserTurnId: 'turn',
      requestedByUserId: 'user',
      timestamp: 'now',
      inputConfig: {},
    },
    result: {
      type: 'session/edit-and-resend_response',
      sessionId: 'session',
      replacementUserTurnId: 'turn',
      success: true,
    },
    identities: ['sessionId', 'replacementUserTurnId'],
  },
  {
    method: 'session/fork',
    params: {
      sourceSessionId: 'source',
      sourceTurnId: 'turn',
      targetSessionId: 'target',
      requestedByUserId: 'user',
    },
    result: {
      type: 'session/fork_response',
      sourceSessionId: 'source',
      targetSessionId: 'target',
      success: true,
    },
    identities: ['sourceSessionId', 'targetSessionId'],
  },
];

for (const { method, params, result, identities } of commandCases) {
  test(`${method} rejects each mismatched business identity and accepts a matching reply`, async () => {
    for (const key of [...identities, null]) {
      let listener;
      const rpc = new StreamsMachineCommands({
        workspaceId: 'workspace',
        streams: {
          ensure: async () => {},
          subscribe: async (_id, next) => {
            listener = next;
          },
          append: async () => {
            queueMicrotask(() =>
              listener({
                jsonrpc: '2.0',
                rpcVersion: '1',
                id: 'request',
                result: key ? { ...result, [key]: 'wrong' } : result,
              }),
            );
          },
        },
      });
      const response = rpc.request('machine', method, params, 'request');
      if (key) await assert.rejects(response, /response_identity_mismatch/);
      else assert.deepEqual(await response, result);
    }
  });
}
