import assert from 'node:assert/strict';
import test from 'node:test';

import { Flock } from '@loro-dev/flock-wasm';
import { LoroDoc, LoroMap } from 'loro-crdt';

import { StreamsMachineCommands } from '../dist/index.js';
import { LoroSessionRepository } from '../dist/sessions/infrastructure/loro-session-repository.js';
import { MachineFlockDirectory } from '../dist/sessions/infrastructure/machine-flock.js';

const input = {
  requestId: 'queued-turn',
  timestamp: '2026-10-04T00:00:00Z',
  userId: 'user',
  inputConfig: {
    mcpServerIds: ['research'],
    prompt: 'Queued task',
    cliType: 'builtin',
    agentType: 'claude',
    modelId: 'model',
  },
};

// Lody 9bdac285: shared/schema.ts messageQueueItemSchema; workspace-writer-impl.ts enqueueSessionMessage.
for (const failedStep of ['persist', 'sync', 'notify', 'metadata-sync']) {
  test(`native queue layout survives ${failedStep} failure without duplicate history or queue rows`, async () => {
    const doc = new LoroDoc();
    const events = [];
    let failed = false;
    let meta = { messageQueueCheckedAt: 200 };
    const step = async (name) => {
      events.push(name);
      if (!failed && name === failedStep) {
        failed = true;
        throw new Error('uncertain');
      }
    };
    const repository = new LoroSessionRepository({
      now: () => 100,
      repo: {
        acquireDoc: async () => ({ doc, release: async () => {} }),
        joinDocRoom: async () => ({
          firstSyncedWithRemote: Promise.resolve(),
          waitUntilSynced: () => step('sync'),
          unsubscribe() {},
        }),
        persistDocNow: () => step('persist'),
        getDocMeta: async () => ({ meta }),
        upsertDocMeta: async (_, patch) => {
          await step('notify');
          meta = { ...meta, ...patch };
        },
        persistMetaNow: async () => {},
      },
      metaRoom: { waitUntilSynced: () => step('metadata-sync') },
    });
    const handle = await repository.open('session');
    try {
      await assert.rejects(handle.append(input, 'queue'), /uncertain/);
      events.length = 0;
      await handle.append(input, 'queue');
      assert.deepEqual(events, ['persist', 'sync', 'notify', 'metadata-sync']);
      assert.ok(meta.messageQueueUpdatedAt > meta.messageQueueCheckedAt);
      assert.equal(meta.latestUserMsgId, undefined);
      assert.deepEqual(handle.read().history, []);
      const peer = new LoroDoc();
      peer.import(doc.export({ mode: 'snapshot' }));
      const queue = peer.getMovableList('mq');
      assert.equal(queue.length, 1);
      assert.deepEqual(queue.get(0).toJSON(), {
        task: input.inputConfig.prompt,
        userId: input.userId,
        timestamp: input.timestamp,
        userTurnId: input.requestId,
        operationId: `queue:${input.requestId}`,
        acpSessionConfig: input.inputConfig,
      });
      assert.equal(handle.read().queue[0].userTurnId, input.requestId);
      const { mcpServerIds: _selection, ...withoutSelection } = input.inputConfig;
      await assert.rejects(
        handle.append({ ...input, inputConfig: withoutSelection }, 'queue'),
        /request_conflict/,
      );
      await assert.rejects(
        handle.append(
          { ...input, inputConfig: { ...input.inputConfig, mcpServerIds: [] } },
          'queue',
        ),
        /request_conflict/,
      );
      await assert.rejects(
        handle.append(
          { ...input, inputConfig: { ...input.inputConfig, prompt: 'Changed' } },
          'queue',
        ),
        /request_conflict/,
      );
      await assert.rejects(handle.append(input, 'dispatch'), /request_conflict/);
      // The CLI promotes a queue row into history and removes it from mq.
      doc.getMovableList('mq').delete(0, 1);
      const promoted = doc.getList('history').insertContainer(0, new LoroMap());
      for (const [key, value] of Object.entries({
        id: input.requestId,
        role: 'user',
        userId: input.userId,
        timestamp: input.timestamp,
        status: 'completed',
        inputConfig: { ...input.inputConfig, resume: 'acp-session' },
      }))
        promoted.set(key, value);
      doc.commit();
      events.length = 0;
      await handle.append(input, 'queue');
      assert.deepEqual(events, ['persist', 'sync']);
      assert.equal(handle.read().queue.length, 0);
      assert.equal(handle.read().history.length, 1);
    } finally {
      await handle.close();
      await repository.close();
    }
  });
}

const progress = {
  type: 'machine/acp-binary-progress',
  machineId: 'machine',
  agentType: 'claude',
  status: 'downloading',
  percent: 1,
};
const terminal = {
  type: 'machine/acp-capabilities-refresh_response',
  machineId: 'machine',
  configId: 'agent',
  cliType: 'builtin',
  agentType: 'claude',
  success: true,
};

function rpcFixture(timeoutMs = 1000) {
  let receive;
  let subscriptionSignal;
  let appended;
  const ready = new Promise((resolve) => {
    appended = resolve;
  });
  const commands = new StreamsMachineCommands({
    workspaceId: 'workspace',
    timeoutMs,
    streams: {
      ensure: async () => {},
      subscribe: async (_, listener, signal) => {
        receive = listener;
        subscriptionSignal = signal;
      },
      append: async () => appended(),
    },
  });
  return {
    commands,
    ready,
    result: (result) => receive({ jsonrpc: '2.0', rpcVersion: '1', id: 'request', result }),
    error: () =>
      receive({
        jsonrpc: '2.0',
        rpcVersion: '1',
        id: 'request',
        error: { code: 'refresh_failed', message: 'failed' },
      }),
    aborted: () => subscriptionSignal.aborted,
  };
}

for (const outcome of ['success', 'failure', 'rpc-error']) {
  test(`refresh keeps progress pending until terminal ${outcome}`, async () => {
    const rpc = rpcFixture();
    const response = rpc.commands.request(
      'machine',
      'machine/acp-capabilities-refresh',
      { configId: 'agent' },
      'request',
    );
    let settled = false;
    response.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await rpc.ready;
    rpc.result(progress);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(rpc.aborted(), false);
    if (outcome === 'rpc-error') {
      rpc.error();
      await assert.rejects(response, /refresh_failed/);
    } else {
      const result = {
        ...terminal,
        success: outcome === 'success',
        ...(outcome === 'failure' ? { error: 'install failed' } : {}),
      };
      rpc.result(result);
      assert.deepEqual(await response, result);
    }
    assert.equal(rpc.aborted(), true);
  });
}

for (const invalid of [
  { ...progress, machineId: 'other' },
  { ...progress, percent: 101 },
  { ...terminal, configId: 'other' },
  { ...terminal, machineId: 'other' },
  {},
]) {
  test(`refresh rejects invalid or mismatched response ${JSON.stringify(invalid)}`, async () => {
    const rpc = rpcFixture();
    const response = rpc.commands.request(
      'machine',
      'machine/acp-capabilities-refresh',
      { configId: 'agent' },
      'request',
    );
    await rpc.ready;
    rpc.result(invalid);
    await assert.rejects(response);
    assert.equal(rpc.aborted(), true);
  });
}

test('valid refresh progress renews the silence deadline and caller cancellation still stops it', async () => {
  const rpc = rpcFixture(100);
  const controller = new AbortController();
  const response = rpc.commands.request(
    'machine',
    'machine/acp-capabilities-refresh',
    { configId: 'agent' },
    'request',
    controller.signal,
  );
  const checked = assert.rejects(response, /caller stopped/);
  await rpc.ready;
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    rpc.result(progress);
    assert.equal(rpc.aborted(), false);
  }
  controller.abort(new Error('caller stopped'));
  await checked;
  const silent = rpcFixture(10);
  const timedOut = silent.commands.request(
    'machine',
    'machine/acp-capabilities-refresh',
    { configId: 'agent' },
    'request',
  );
  await assert.rejects(timedOut, (error) => error.name === 'TimeoutError');
});

test('real Flock merges model declarations only for the matching capability version', async () => {
  const flock = new Flock();
  const capability = {
    cliType: 'builtin',
    agentType: 'claude',
    sourceVersion: 'v1',
    fetchedAt: 1,
    models: [{ modelId: 'model', name: 'Model' }],
    modes: [],
  };
  const declaration = {
    version: 1,
    sourceVersion: 'v1',
    models: { model: { effortValues: ['low'], fastMode: false } },
  };
  flock.set(['acpModelCapability', 'agent'], declaration);
  flock.set(['acpCapability', 'agent'], capability);
  flock.commit();
  const directory = new MachineFlockDirectory({
    workspaceId: 'workspace',
    repo: {
      acquireFlockDoc: async () => ({ flock, release: async () => {} }),
      joinFlockDocRoom: async () => ({
        firstSyncedWithRemote: Promise.resolve(),
        unsubscribe() {},
      }),
    },
  });
  const machine = await directory.open('machine');
  try {
    assert.deepEqual(machine.read().capabilities.agent.declaredModelControls, declaration.models);
    flock.set(['acpModelCapability', 'agent'], { ...declaration, sourceVersion: 'old' });
    flock.commit();
    assert.equal(machine.read().capabilities.agent.declaredModelControls, undefined);
    flock.set(['acpModelCapability', 'agent'], {
      ...declaration,
      models: { model: { fastMode: 'yes' } },
    });
    flock.commit();
    assert.throws(() => machine.read());
  } finally {
    await directory.close();
  }
});
