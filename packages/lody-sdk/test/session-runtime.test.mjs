import assert from 'node:assert/strict';
import test from 'node:test';

import { LoroDoc } from 'loro-crdt';

import { StreamsMachineCommands } from '../dist/index.js';
import { LoroSessionRepository } from '../dist/sessions/infrastructure/loro-session-repository.js';

test('real Loro writer preserves history, persists before dispatch, and deduplicates turn identity', async () => {
  const doc = new LoroDoc();
  const events = [];
  const repository = new LoroSessionRepository({
    repo: {
      acquireDoc: async () => ({ doc, release: async () => {} }),
      joinDocRoom: async () => ({
        firstSyncedWithRemote: Promise.resolve(),
        waitUntilSynced: async () => events.push('history-remote'),
        unsubscribe() {},
      }),
      persistDocNow: async () => events.push('history'),
      getDocMeta: async () => null,
      upsertDocMeta: async (id, patch) => events.push(patch),
      persistMetaNow: async () => events.push('meta'),
      listDoc: async () => [],
      watch: () => ({ unsubscribe() {} }),
    },
    metaRoom: { waitUntilSynced: async () => events.push('meta-remote') },
  });
  const handle = await repository.open('session');
  const input = {
    requestId: 'turn',
    timestamp: '2026-10-03T00:00:00Z',
    userId: 'user',
    inputConfig: {
      prompt: 'Hello',
      mcpServerIds: ['research'],
      cliType: 'builtin',
      agentType: 'codex',
      inputBlocks: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'Web page context' },
      ],
    },
  };
  await handle.append(input, 'dispatch');
  assert.deepEqual(events, [
    'history',
    'history-remote',
    { latestUserMsgId: 'turn', lastMessageAt: Date.parse(input.timestamp) },
    'meta',
    'meta-remote',
  ]);
  assert.equal(handle.read().history[0].items[0].text, 'Hello');
  assert.equal(handle.read().history[0].read, false);
  assert.deepEqual(handle.read().history[0].inputConfig.inputBlocks, input.inputConfig.inputBlocks);
  assert.deepEqual(handle.read().history[0].inputConfig.mcpServerIds, ['research']);
  await assert.rejects(
    handle.append(
      { ...input, inputConfig: { ...input.inputConfig, mcpServerIds: [] } },
      'dispatch',
    ),
    /request_conflict/,
  );
  await handle.append(input, 'dispatch');
  assert.equal(handle.read().history.length, 1);
  await assert.rejects(
    handle.append(
      { ...input, inputConfig: { ...input.inputConfig, prompt: 'different' } },
      'dispatch',
    ),
    /request_conflict/,
  );
  assert.throws(() =>
    handle.append(
      {
        ...input,
        requestId: 'invalid',
        inputConfig: { ...input.inputConfig, inputBlocks: [{ type: 'text', text: 123 }] },
      },
      'dispatch',
    ),
  );
  assert.equal(handle.read().history.length, 1);
  await handle.close();
  await repository.close();
});

test('dispatch seeds activity once without replacing later daemon-owned activity', async () => {
  const doc = new LoroDoc();
  let metadata = {};
  const repository = new LoroSessionRepository({
    repo: {
      acquireDoc: async () => ({ doc, release: async () => {} }),
      joinDocRoom: async () => ({
        firstSyncedWithRemote: Promise.resolve(),
        waitUntilSynced: async () => {},
        unsubscribe() {},
      }),
      persistDocNow: async () => {},
      getDocMeta: async () => ({ meta: metadata }),
      upsertDocMeta: async (_id, patch) => {
        metadata = { ...metadata, ...patch };
      },
      persistMetaNow: async () => {},
    },
    metaRoom: { waitUntilSynced: async () => {} },
  });
  const handle = await repository.open('session');
  const first = {
    requestId: 'first',
    userId: 'user',
    timestamp: '2026-10-05T00:00:00.000Z',
    inputConfig: { prompt: 'Hello', cliType: 'builtin', agentType: 'codex' },
  };
  try {
    await handle.append(first, 'dispatch');
    assert.equal(metadata.lastMessageAt, Date.parse(first.timestamp));
    metadata.lastMessageAt = Date.parse(first.timestamp) + 10000;
    await handle.append(
      { ...first, requestId: 'second', timestamp: '2026-10-05T00:00:01.000Z' },
      'dispatch',
    );
    assert.equal(metadata.latestUserMsgId, 'second');
    assert.equal(metadata.lastMessageAt, Date.parse(first.timestamp) + 10000);
    await handle.append(first, 'dispatch');
    assert.equal(metadata.latestUserMsgId, 'second');
    assert.equal(handle.read().history.length, 2);
  } finally {
    await handle.close();
    await repository.close();
  }
});

for (const stopped of ['archived', 'deleted']) {
  test(`retry never activates a ${stopped} conversation`, async () => {
    const doc = new LoroDoc();
    let stoppedTarget = false;
    let patches = 0;
    const repository = new LoroSessionRepository({
      repo: {
        acquireDoc: async () => ({ doc, release: async () => {} }),
        joinDocRoom: async () => ({
          firstSyncedWithRemote: Promise.resolve(),
          waitUntilSynced: async () => {},
          unsubscribe() {},
        }),
        persistDocNow: async () => {},
        getDocMeta: async () => ({
          deleted: stoppedTarget && stopped === 'deleted',
          meta: { isArchived: stoppedTarget && stopped === 'archived' },
        }),
        upsertDocMeta: async () => {
          patches++;
        },
        persistMetaNow: async () => {},
      },
      metaRoom: { waitUntilSynced: async () => {} },
    });
    const handle = await repository.open('session');
    const input = {
      requestId: 'turn',
      userId: 'user',
      timestamp: '2026-10-05T00:00:00.000Z',
      inputConfig: { prompt: 'Hello', cliType: 'builtin', agentType: 'codex' },
    };
    try {
      await handle.append(input, 'dispatch');
      assert.equal(patches, 1);
      stoppedTarget = true;
      await handle.append(input, 'dispatch');
      assert.equal(patches, 1);
      assert.equal(handle.read().history.length, 1);
    } finally {
      await handle.close();
      await repository.close();
    }
  });
}

test('same-watermark retry still confirms metadata after an uncertain sync receipt', async () => {
  const doc = new LoroDoc();
  let metadata = {};
  let syncs = 0;
  let patches = 0;
  const repository = new LoroSessionRepository({
    repo: {
      acquireDoc: async () => ({ doc, release: async () => {} }),
      joinDocRoom: async () => ({
        firstSyncedWithRemote: Promise.resolve(),
        waitUntilSynced: async () => {},
        unsubscribe() {},
      }),
      persistDocNow: async () => {},
      getDocMeta: async () => ({ meta: metadata }),
      upsertDocMeta: async (_id, patch) => {
        patches++;
        metadata = { ...metadata, ...patch };
      },
      persistMetaNow: async () => {},
    },
    metaRoom: {
      waitUntilSynced: async () => {
        if (++syncs === 1) throw new Error('lost receipt');
      },
    },
  });
  const handle = await repository.open('session');
  const input = {
    requestId: 'turn',
    userId: 'user',
    timestamp: '2026-10-05T00:00:00.000Z',
    inputConfig: { prompt: 'Hello', cliType: 'builtin', agentType: 'codex' },
  };
  try {
    await assert.rejects(handle.append(input, 'dispatch'), /lost receipt/);
    await handle.append(input, 'dispatch');
    assert.equal(syncs, 2);
    assert.equal(patches, 1);
    assert.equal(handle.read().history.length, 1);
  } finally {
    await handle.close();
    await repository.close();
  }
});

test('machine command subscribes before appending real envelope and correlates response identity', async () => {
  const events = [];
  let listener;
  const rpc = new StreamsMachineCommands({
    workspaceId: 'w',
    now: () => 100,
    streams: {
      ensure: async (id) => events.push(id),
      subscribe: async (id, next) => {
        events.push('subscribe');
        listener = next;
      },
      append: async (id, value) => {
        events.push(value);
        listener({ jsonrpc: '2.0', rpcVersion: '1', id: 'unrelated', result: {} });
        listener({
          jsonrpc: '2.0',
          rpcVersion: '1',
          id: 'request',
          result: { type: 'session/cancel_response', sessionId: 's', success: true },
        });
      },
    },
  });
  assert.deepEqual(
    await rpc.request('m', 'session/cancel', { sessionId: 's', turnId: 't' }, 'request'),
    { type: 'session/cancel_response', sessionId: 's', success: true },
  );
  assert.equal(events[2], 'subscribe');
  assert.deepEqual(events[3], {
    jsonrpc: '2.0',
    id: 'request',
    method: 'session/cancel',
    rpcVersion: '1',
    machineId: 'm',
    workspaceId: 'w',
    replyTo: 'w:rpc:res:m',
    sentAt: 100,
    expiresAt: 30100,
    params: { sessionId: 's', turnId: 't' },
  });
});
