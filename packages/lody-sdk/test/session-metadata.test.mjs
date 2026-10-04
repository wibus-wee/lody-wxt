import assert from 'node:assert/strict';
import test from 'node:test';

import { LoroDoc, LoroMap } from 'loro-crdt';
import { LoroRepo } from 'loro-repo';

import { LoroSessionRepository } from '../dist/sessions/infrastructure/loro-session-repository.js';

// Lody shared/session-operation-targets.ts projects identity from the document key.
test('session metadata reads canonical room identity without requiring a duplicate id field', async () => {
  const repo = await LoroRepo.create({ metaDebounceCommitMs: 0 });
  const repository = new LoroSessionRepository({
    repo,
    metaRoom: { waitUntilSynced: async () => {} },
  });
  const metadata = {
    machineId: 'machine',
    userId: 'user',
    agentConfigId: 'agent',
    createdAt: '2026-01-01T00:00:00.000Z',
    isArchived: false,
  };
  try {
    await repo.upsertDocMeta('session-official', metadata);
    assert.deepEqual(await repository.list(), [{ ...metadata, id: 'official' }]);
    await repository.create({ ...metadata, id: 'official' });
    assert.equal((await repo.getDocMeta('session-official')).meta.id, undefined);
    await repo.upsertDocMeta('session-official', { id: 'different' });
    await assert.rejects(repository.list(), /session_metadata_identity_conflict: session-official/);
  } finally {
    await repository.close();
    await repo.destroy();
  }
});

test('malformed metadata identifies the document and field without exposing content', async () => {
  const repository = new LoroSessionRepository({
    repo: {
      listDoc: async () => [
        {
          docId: 'session-broken',
          meta: { machineId: 42, userId: 'user', createdAt: '2026-01-01', isArchived: false },
        },
      ],
    },
  });
  await assert.rejects(repository.list(), /session_metadata_invalid: session-broken at machineId/);
});

test('malformed history identifies its position instead of an ambiguous missing id error', async () => {
  const doc = new LoroDoc();
  const turn = doc.getList('history').insertContainer(0, new LoroMap());
  turn.set('role', 'assistant');
  turn.set('timestamp', '2026-01-01T00:00:00.000Z');
  doc.commit();
  const repository = new LoroSessionRepository({
    repo: {
      acquireDoc: async () => ({ doc, release: async () => {} }),
      joinDocRoom: async () => ({
        firstSyncedWithRemote: Promise.resolve(),
        waitUntilSynced: async () => {},
        unsubscribe() {},
      }),
    },
  });
  const handle = await repository.open('broken-history');
  assert.throws(
    () => handle.read(),
    /session_document_invalid: session-broken-history at history.0.id/,
  );
  await handle.close();
  await repository.close();
});

test('live malformed history reports an error and resumes after a valid update', async () => {
  const doc = new LoroDoc();
  const repository = new LoroSessionRepository({
    repo: {
      acquireDoc: async () => ({ doc, release: async () => {} }),
      joinDocRoom: async () => ({
        firstSyncedWithRemote: Promise.resolve(),
        waitUntilSynced: async () => {},
        unsubscribe() {},
      }),
    },
  });
  const handle = await repository.open('live');
  const errors = [];
  const updates = [];
  const unsubscribe = handle.subscribe(
    (snapshot) => updates.push(snapshot),
    (error) => errors.push(error.message),
  );
  const turn = doc.getList('history').insertContainer(0, new LoroMap());
  turn.set('role', 'assistant');
  turn.set('timestamp', '2026-01-01T00:00:00.000Z');
  doc.commit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /session_document_invalid: session-live at history.0.id/);
  assert.equal(updates.length, 0);
  turn.set('id', 'answer');
  doc.commit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(updates.at(-1).history[0].id, 'answer');
  unsubscribe();
  await handle.close();
  await repository.close();
});
