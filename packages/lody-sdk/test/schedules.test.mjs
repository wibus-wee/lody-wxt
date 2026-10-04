import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { Flock } from '@loro-dev/flock-wasm';
import { LoroDoc } from 'loro-crdt';

import { ProtocolScheduleRepository, scheduleDefinitionFingerprint } from '../dist/index.js';
import { LoroScheduleStorage } from '../dist/schedules/infrastructure/loro-schedule-storage.js';

const input = {
  scheduleId: 'daily',
  actorId: 'user',
  activationId: 'activation-one',
  activityId: 'request-one',
  now: 100,
  create: true,
  draft: {
    title: 'Daily research',
    machineId: 'machine',
    prompt: 'Summarize updates',
    trigger: { kind: 'cron', expression: '0 9 * * MON-FRI', timeZone: 'Asia/Singapore' },
    misfirePolicy: { kind: 'skip' },
    overlapPolicy: 'skip',
    agent: { agentConfigId: 'agent', modelId: 'model', configOptionValues: { effort: 'high' } },
    retryPolicy: { dispatchMaxAttempts: 5, dispatchMaxAgeMs: 86_400_000 },
  },
};
function fixture() {
  const documents = new Map();
  const flock = new Flock();
  const events = [];
  let fail = '';
  const step = async (name) => {
    events.push(name);
    if (fail === name) {
      fail = '';
      throw new Error('uncertain');
    }
  };
  let opened = 0;
  let closed = 0;
  const repo = {
    acquireFlockDoc: async (id) => {
      assert.equal(id, 'workspace:sr');
      opened++;
      return {
        flock,
        release: async () => {
          closed++;
        },
      };
    },
    joinFlockDocRoom: async () => ({
      firstSyncedWithRemote: Promise.resolve(),
      waitUntilSynced: () => step('registry-sync'),
      unsubscribe() {},
    }),
    persistFlockDocNow: () => step('registry-persist'),
    acquireDoc: async (id) => {
      assert.equal(id, 'schedule-daily');
      if (!documents.has(id)) documents.set(id, new LoroDoc());
      opened++;
      return {
        doc: documents.get(id),
        release: async () => {
          closed++;
        },
      };
    },
    joinDocRoom: async () => ({
      firstSyncedWithRemote: Promise.resolve(),
      waitUntilSynced: () => step('document-sync'),
      unsubscribe() {},
    }),
    persistDocNow: () => step('document-persist'),
  };
  const storage = new LoroScheduleStorage({
    repo,
    workspaceId: 'workspace',
    signal: new AbortController().signal,
    timeoutMs: 1000,
  });
  return {
    schedules: new ProtocolScheduleRepository(storage),
    documents,
    flock,
    events,
    failAt: (name) => {
      fail = name;
    },
    resources: () => [opened, closed],
  };
}
test('schedule storage uses the official Loro shape and publishes definition before registry', async () => {
  const state = fixture();
  const document = await state.schedules.save(input);
  assert.deepEqual(state.events, [
    'document-persist',
    'document-sync',
    'registry-persist',
    'registry-sync',
  ]);
  assert.deepEqual(await state.schedules.read('daily'), document);
  const peer = new LoroDoc();
  peer.import(state.documents.get('schedule-daily').export({ mode: 'snapshot' }));
  assert.equal(peer.getText('prompt').toString(), input.draft.prompt);
  assert.equal(peer.getMap('definition').get('agent').agentConfigId, 'agent');
  assert.equal(peer.getList('timeline').get(0).get('id'), 'request-one');
  const [row] = await state.schedules.list();
  assert.equal(row.definitionFingerprint, await scheduleDefinitionFingerprint(document));
  const {
    title: _title,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    createdBy: _createdBy,
    ...execution
  } = document.definition;
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  const expected = createHash('sha256')
    .update(JSON.stringify(canonical({ definition: execution, prompt: document.prompt })))
    .digest('hex');
  assert.equal(row.definitionFingerprint, expected);
  assert.equal(row.elevatedPermissions, false);
  assert.deepEqual(state.resources().slice(0, 1), state.resources().slice(1));
});
for (const failure of ['document-persist', 'document-sync', 'registry-persist', 'registry-sync']) {
  test(`schedule ${failure} uncertainty reuses activation and activity without duplicate timeline`, async () => {
    const state = fixture();
    state.failAt(failure);
    await assert.rejects(state.schedules.save(input), /uncertain/);
    if (failure.startsWith('document')) assert.deepEqual(await state.schedules.list(), []);
    const saved = await state.schedules.save(input);
    assert.equal(saved.definition.activationId, 'activation-one');
    assert.equal(saved.timeline.length, 1);
    assert.equal((await state.schedules.list()).length, 1);
    await assert.rejects(
      state.schedules.save({ ...input, draft: { ...input.draft, prompt: 'conflict' } }),
      /Idempotency key conflict/,
    );
  });
}
test('schedule owners, activation changes, manual identity and tombstones survive stale writes', async () => {
  const state = fixture();
  await state.schedules.save(input);
  await assert.rejects(state.schedules.delete('daily', 'other', 200), /owner/);
  await state.schedules.setEnabled({
    scheduleId: 'daily',
    actorId: 'user',
    enabled: false,
    now: 200,
    activationId: 'unused',
    requestId: 'pause',
  });
  assert.equal((await state.schedules.read('daily')).definition.activationId, 'activation-one');
  await state.schedules.setEnabled({
    scheduleId: 'daily',
    actorId: 'user',
    enabled: true,
    now: 300,
    activationId: 'activation-two',
    requestId: 'resume',
  });
  assert.equal((await state.schedules.read('daily')).definition.activationId, 'activation-two');
  const request = { scheduleId: 'daily', actorId: 'user', manualRunId: 'run-one', now: 400 };
  await state.schedules.requestRun(request);
  await state.schedules.requestRun({ ...request, now: 500 });
  assert.equal(state.flock.get(['manual', 'daily', 'run-one']).requestedAt, 400);
  await state.schedules.delete('daily', 'user', 600);
  assert.deepEqual(await state.schedules.list(), []);
  assert.ok(await state.schedules.read('daily'));
  await assert.rejects(state.schedules.save(input), /deleted|Idempotency/);
});
test('invalid cron, zones, credentials, byte budgets and protocol identities are visible errors', async () => {
  const state = fixture();
  for (const trigger of [
    { kind: 'cron', expression: '0 0 0 * * *', timeZone: 'UTC' },
    { kind: 'cron', expression: '90 9 * * *', timeZone: 'UTC' },
    { kind: 'cron', expression: '0 9 * * *', timeZone: 'Unknown/Zone' },
  ])
    await assert.rejects(state.schedules.save({ ...input, draft: { ...input.draft, trigger } }));
  await assert.rejects(
    state.schedules.save({
      ...input,
      draft: {
        ...input.draft,
        agent: { agentConfigId: 'agent', configOptionValues: { api_key: 'secret' } },
      },
    }),
  );
  await assert.rejects(
    state.schedules.save({ ...input, draft: { ...input.draft, prompt: '字'.repeat(12_000) } }),
  );
  assert.deepEqual(state.events, []);
  state.flock.set(['runtime', 'daily', 'machine'], {
    scheduleId: 'wrong',
    machineId: 'machine',
    activationId: 'activation',
    observedDefinitionFingerprint: '',
    updatedAt: 0,
  });
  state.flock.commit();
  await assert.rejects(state.schedules.runtimeRows(), /identity mismatch/);
});

test('manual run recovery confirms the existing command after a lost registry acknowledgement', async () => {
  const state = fixture();
  await state.schedules.save(input);
  state.failAt('registry-sync');
  const request = {
    scheduleId: 'daily',
    actorId: 'user',
    manualRunId: 'manual-recovery',
    now: 400,
  };
  await assert.rejects(state.schedules.requestRun(request), /uncertain/);
  state.events.length = 0;
  await state.schedules.requestRun({ ...request, now: 500 });
  assert.deepEqual(state.events, ['registry-persist', 'registry-sync']);
  assert.equal(state.flock.get(['manual', 'daily', 'manual-recovery']).requestedAt, 400);
});
