import assert from 'node:assert/strict';
import test from 'node:test';

import { Flock } from '@loro-dev/flock-wasm';
import { LoroDoc } from 'loro-crdt';
import { LoroRepo } from 'loro-repo';

import {
  canAccessShortcutDomain,
  ConvexPromptShortcuts,
  getShortcutBodyStreamId,
  getShortcutIndexStreamId,
  LocalShortcutStore,
  parsePromptShortcut,
  projectShortcutIndex,
  PromptShortcutRuntime,
  PromptShortcutSync,
  resolveShortcutAvailability,
} from '../dist/index.js';
import { PromptShortcutCatalog } from '../dist/shortcuts/infrastructure/catalog.js';
import { PromptShortcutDocument } from '../dist/shortcuts/infrastructure/document.js';
import { readonlyShortcutAdapter } from '../dist/shortcuts/infrastructure/sync.js';

const shortcut = (patch = {}) => ({
  v: 1,
  id: 'review',
  workspaceId: 'workspace',
  ownerUserId: 'user-a',
  visibility: 'private',
  name: 'Review changes',
  emoji: '📝',
  slug: 'review',
  prompt: 'Review these changes',
  mentions: [],
  scope: {},
  revision: 'revision-one',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});
const directoryRow = (entry) => ({
  shortcutId: entry.id,
  bodyDocId: entry.bodyDocId,
  ownerUserId: entry.ownerUserId,
  visibility: entry.visibility,
  revision: entry.revision,
});
async function fixture(t, remote) {
  const repo = await LoroRepo.create({});
  const store = await LocalShortcutStore.open({ repo, workspaceId: 'workspace', userId: 'user-a' });
  const runtime = new PromptShortcutRuntime(store, remote);
  t.after(async () => {
    await runtime.dispose();
    await repo.destroy();
  });
  return { repo, store, runtime };
}
async function saveBody(repo, entry, value) {
  const lease = await repo.acquireDoc(getShortcutBodyStreamId(entry.bodyDocId));
  try {
    new PromptShortcutDocument(lease.doc).save(value, []);
    await repo.persistDocNow(getShortcutBodyStreamId(entry.bodyDocId), lease.doc);
  } finally {
    await lease.release();
  }
}
const noopRemote = (patch = {}) => ({
  acquire: async () => ({ sync: async () => {}, join: async () => {}, release: async () => {} }),
  stage: async () => 'active',
  activate: async () => {},
  settle: async () => 'active',
  revoke: async () => {},
  dispose: async () => {},
  ...patch,
});

test('shortcut resources and access match private-owner/workspace-reader domains', () => {
  const domain = { workspaceId: 'workspace', ownerUserId: 'other', visibility: 'private' };
  assert.equal(getShortcutIndexStreamId(domain), 'shortcut-index:workspace:other:private');
  assert.equal(getShortcutBodyStreamId('body'), 'shortcut-body:body');
  assert.equal(
    canAccessShortcutDomain({
      domain,
      userId: 'user-a',
      isWorkspaceMember: true,
      operation: 'read',
    }),
    false,
  );
  assert.equal(
    canAccessShortcutDomain({
      domain: { ...domain, visibility: 'workspace' },
      userId: 'user-a',
      isWorkspaceMember: true,
      operation: 'read',
    }),
    true,
  );
  assert.equal(
    canAccessShortcutDomain({
      domain: { ...domain, visibility: 'workspace' },
      userId: 'user-a',
      isWorkspaceMember: true,
      operation: 'write',
    }),
    false,
  );
  assert.equal(
    canAccessShortcutDomain({
      domain,
      userId: 'other',
      isWorkspaceMember: false,
      operation: 'write',
    }),
    false,
  );
});

test('shortcut compiler preserves UTF-16 labels and requires compatible explicit mention scope', () => {
  const valid = shortcut({
    prompt: 'Read @file',
    mentions: [
      {
        start: 5,
        end: 10,
        label: '@file',
        target: {
          kind: 'file',
          project: { kind: 'local', id: 'project', machineId: 'machine' },
          path: 'README.md',
        },
      },
    ],
    scope: {
      project: { kind: 'local', id: 'project', machineId: 'machine' },
      machineId: 'machine',
    },
  });
  assert.deepEqual(parsePromptShortcut(valid), valid);
  assert.throws(() => parsePromptShortcut({ ...valid, scope: {} }), { code: 'missing_scope' });
  assert.throws(
    () => parsePromptShortcut({ ...valid, mentions: [{ ...valid.mentions[0], start: 4 }] }),
    { code: 'invalid_ranges' },
  );
  assert.throws(
    () =>
      parsePromptShortcut({
        ...valid,
        prompt: '😀',
        mentions: [{ ...valid.mentions[0], start: 0, end: 1, label: '\uD83D' }],
      }),
    { code: 'invalid_ranges' },
  );
  assert.throws(() => parsePromptShortcut(shortcut({ prompt: 'a'.repeat(256 * 1024 + 1) })), {
    code: 'invalid_template',
  });
  assert.equal(
    resolveShortcutAvailability({
      shortcut: valid,
      dependencies: valid.mentions.map((row) => row.target),
      context: { workspaceId: 'workspace', userId: 'user-a', scope: {} },
      canRead: true,
      resolveDependency: () => ({ kind: 'available' }),
    }).reason,
    'project_mismatch',
  );
});

test('immutable Loro revisions retain concurrent saves instead of selecting a merged winner', () => {
  const initial = new LoroDoc();
  new PromptShortcutDocument(initial).save(shortcut(), []);
  const left = new LoroDoc();
  const right = new LoroDoc();
  left.import(initial.export({ mode: 'snapshot' }));
  right.import(initial.export({ mode: 'snapshot' }));
  const a = shortcut({ revision: 'left', prompt: 'Left edit', updatedAt: 2 });
  const b = shortcut({ revision: 'right', prompt: 'Right edit', updatedAt: 2 });
  new PromptShortcutDocument(left).save(a, ['revision-one']);
  new PromptShortcutDocument(right).save(b, ['revision-one']);
  left.import(right.export({ mode: 'snapshot' }));
  const document = new PromptShortcutDocument(left);
  assert.throws(() => document.read(), { code: 'conflict' });
  assert.throws(() => document.save(a, ['revision-one']), { code: 'conflict' });
  const resolved = shortcut({ revision: 'resolved', prompt: 'Explicit merged text', updatedAt: 3 });
  document.save(resolved, ['left', 'right']);
  assert.deepEqual(document.read(), resolved);
  assert.throws(
    () => document.save({ ...resolved, prompt: 'Reuse changed text' }, ['left', 'right']),
    { code: 'conflict' },
  );
  assert.deepEqual(left.getMap('revisions').get('resolved'), { parents: ['left', 'right'] });
});

test('catalog deletion tombstone survives a later stale active row', () => {
  const flock = new Flock();
  const catalog = new PromptShortcutCatalog(flock);
  const entry = projectShortcutIndex(shortcut(), 'body');
  catalog.put(entry);
  catalog.remove(entry.id, 'delete-revision');
  flock.set(['promptShortcut', entry.id], { kind: 'active', entry });
  flock.commit();
  assert.deepEqual(catalog.list(), []);
  assert.throws(() => catalog.put(entry), { code: 'conflict' });
});

test('local durability freezes publication bytes and IDs across subsequent private edits', async (t) => {
  const { store } = await fixture(t);
  const first = await store.save({ value: shortcut(), bodyDocId: 'working', base: null });
  const job = await store.preparePublication(first.entry.id);
  assert.notEqual(job.entry.bodyDocId, first.entry.bodyDocId);
  assert.equal((await store.read(job.entry)).prompt, 'Review these changes');
  const edited = await store.save({
    value: shortcut({
      revision: 'revision-two',
      prompt: 'Not confirmed for sharing',
      updatedAt: 2,
    }),
    base: first.entry,
    bodyDocId: first.entry.bodyDocId,
  });
  assert.deepEqual(await store.preparePublication(first.entry.id), job);
  assert.equal((await store.read(job.entry)).prompt, 'Review these changes');
  assert.equal((await store.read(edited.entry)).prompt, 'Not confirmed for sharing');
  await store.acknowledge(job);
  assert.equal(store.get(first.entry.id).operation, 'save');
  const next = await store.preparePublication(first.entry.id);
  assert.notEqual(next.entry.bodyDocId, job.entry.bodyDocId);
  assert.equal(next.published.bodyDocId, job.entry.bodyDocId);
  assert.equal((await store.read(next.entry)).prompt, 'Not confirmed for sharing');
});

test('visibility rotation and owner checks protect remote history and private working copies', async (t) => {
  const { store } = await fixture(t);
  const first = await store.save({ value: shortcut(), bodyDocId: 'private-working', base: null });
  await assert.rejects(
    store.save({
      value: shortcut({ visibility: 'workspace', revision: 'shared' }),
      bodyDocId: first.entry.bodyDocId,
      base: first.entry,
    }),
    { code: 'conflict' },
  );
  const shared = await store.save({
    value: shortcut({ visibility: 'workspace', revision: 'shared' }),
    bodyDocId: 'fresh-shared-working',
    base: first.entry,
  });
  assert.notEqual(shared.entry.bodyDocId, first.entry.bodyDocId);
  assert.equal((await store.read(first.entry)).visibility, 'private');
  await assert.rejects(store.remove({ ...shared.entry, ownerUserId: 'other' }), {
    code: 'forbidden',
  });
  await assert.rejects(
    LocalShortcutStore.open({
      repo: { hasTransport: () => true },
      workspaceId: 'workspace',
      userId: 'user-a',
    }),
    /must not use workspace transports/,
  );
});

test('runtime exposes local pending/error and retries the exact frozen publication after uncertain stage', async (t) => {
  const attempts = [];
  let fail = true;
  const { runtime, store } = await fixture(
    t,
    noopRemote({
      stage: async (record) => {
        attempts.push(structuredClone(record));
        if (fail) throw new Error('lost stage confirmation');
        return 'active';
      },
    }),
  );
  const entry = await runtime.save({ value: shortcut(), bodyDocId: 'working', base: null });
  await runtime.flush();
  assert.deepEqual(runtime.getSnapshot().pendingIds, [entry.id]);
  assert.match(runtime.getSnapshot().errors[entry.id].message, /lost stage/);
  const durable = store.publication(entry.id);
  fail = false;
  await runtime.flush();
  assert.deepEqual(attempts, [durable, durable]);
  assert.deepEqual(runtime.getSnapshot().pendingIds, []);
  assert.equal(store.get(entry.id).operation, null);
  assert.equal((await runtime.read(runtime.getSnapshot().entries[0])).prompt, shortcut().prompt);
});

test('cached shared bodies are hidden immediately when the authoritative directory revokes access', async (t) => {
  const { runtime, store, repo } = await fixture(t, noopRemote());
  const value = shortcut({ ownerUserId: 'user-b', visibility: 'workspace' });
  const entry = projectShortcutIndex(value, 'shared-body');
  await saveBody(repo, entry, value);
  await store.cacheDiscovery({ directory: [directoryRow(entry)], entries: [entry] });
  // The runtime started before this cache was populated; use the live index for discovery.
  const index = await repo.acquireFlockDoc(getShortcutIndexStreamId(value));
  new PromptShortcutCatalog(index.flock).put(entry);
  await index.release();
  await runtime.setDirectory([directoryRow(entry)]);
  assert.equal(runtime.getSnapshot().entries.length, 1);
  assert.deepEqual(await runtime.read(entry), value);
  const revocation = runtime.setDirectory([]);
  assert.equal(runtime.getSnapshot().entries.length, 0);
  await assert.rejects(runtime.read(entry), { code: 'forbidden' });
  await revocation;
});

test('read-only shortcut replicas never emit update traffic', () => {
  let writes = 0;
  const adapter = readonlyShortcutAdapter({
    emptyVersion: () => ({}),
    mergeVersions: () => ({}),
    exportSnapshot: () => new Uint8Array(),
    applySnapshot: () => {},
    exportUpdates: () => {
      writes++;
    },
    applyRemoteUpdates: () => {},
    subscribeLocalUpdates: () => {
      writes++;
      return () => {};
    },
  });
  assert.equal(adapter.exportUpdates(), null);
  adapter.subscribeLocalUpdates(() => {})();
  assert.equal(writes, 0);
});

test('resource grant mismatch fails before acquiring any replica or opening a stream', async () => {
  let acquired = false;
  const sync = new PromptShortcutSync({
    repo: {
      acquireDoc: () => {
        acquired = true;
      },
    },
    now: () => 0,
    grant: async () => ({
      token: 'resource-token',
      expiresIn: 30,
      gatewayBaseUrl: 'https://streams.example.test',
      streamId: 'workspace:s:not-a-shortcut',
    }),
  });
  await assert.rejects(sync.acquire({ kind: 'body', bodyDocId: 'body' }, false), {
    code: 'forbidden',
  });
  assert.equal(acquired, false);
  await sync.dispose();
});

function cloudFixture() {
  const requests = [];
  let reply;
  const cloud = new ConvexPromptShortcuts({
    origin: 'https://convex.example.test',
    workspaceId: 'workspace',
    userId: 'user-a',
    getJwt: async () => 'header.payload.signature',
    fetch: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return Response.json({ status: 'success', value: reply });
    },
  });
  return {
    cloud,
    requests,
    respond: (value) => {
      reply = value;
    },
  };
}

test('Convex shortcut directory, resource action and mutations use official envelopes and immutable identity', async () => {
  const { cloud, requests, respond } = cloudFixture();
  const entry = projectShortcutIndex(shortcut(), 'publication-body');
  const record = { entry, published: null, operation: 'save', deleted: false };
  respond([directoryRow(entry)]);
  assert.deepEqual(await cloud.listAccessibleDocuments(), [directoryRow(entry)]);
  respond({
    token: 'resource-token',
    expiresIn: 60,
    gatewayBaseUrl: 'https://streams.example.test',
    streamId: 'shortcut-body:publication-body',
  });
  await cloud.getStreamToken({ kind: 'body', bodyDocId: 'publication-body' }, true);
  respond({ bodyDocId: entry.bodyDocId, status: 'staged' });
  assert.equal(await cloud.stage(record), 'staged');
  respond(null);
  await cloud.activate(record);
  respond('cancelled');
  assert.equal(await cloud.settle(record), 'cancelled');
  respond(null);
  await cloud.revoke(entry);
  assert.deepEqual(
    requests.map((row) => [new URL(row.url).pathname, row.body.path]),
    [
      ['/api/query', 'promptShortcuts:listAccessibleDocuments'],
      ['/api/action', 'promptShortcuts:getStreamToken'],
      ['/api/mutation', 'promptShortcuts:stageDocument'],
      ['/api/mutation', 'promptShortcuts:activateDocument'],
      ['/api/mutation', 'promptShortcuts:settleDocument'],
      ['/api/mutation', 'promptShortcuts:revokeShortcut'],
    ],
  );
  assert.deepEqual(requests[1].body.args, {
    workspaceId: 'workspace',
    target: { kind: 'body', bodyDocId: 'publication-body' },
    write: true,
  });
  assert.equal(requests[3].body.args.previousBodyDocId, null);
  assert.equal(requests[3].body.args.previousRevision, null);
  assert.equal(requests[3].body.args.revision, entry.revision);
  assert.equal(
    requests[3].body.args.indexBytes,
    new TextEncoder().encode(JSON.stringify(entry)).length,
  );
  for (const row of requests) {
    assert.equal(row.body.format, 'json');
    assert.equal(row.init.credentials, 'omit');
    assert.equal(row.init.redirect, 'error');
    assert.equal(row.init.headers.Authorization, 'Bearer header.payload.signature');
  }
});

test('cloud boundaries reject private cross-user access, conflicting stage receipts and wrong grants', async () => {
  const { cloud, requests, respond } = cloudFixture();
  const entry = projectShortcutIndex(shortcut(), 'body');
  const record = { entry, published: null, operation: 'save', deleted: false };
  await assert.rejects(
    cloud.getStreamToken(
      {
        kind: 'index',
        domain: { workspaceId: 'workspace', ownerUserId: 'user-b', visibility: 'private' },
      },
      false,
    ),
    { code: 'forbidden' },
  );
  assert.equal(requests.length, 0);
  respond([directoryRow({ ...entry, ownerUserId: 'user-b' })]);
  await assert.rejects(cloud.listAccessibleDocuments(), { code: 'forbidden' });
  respond({ bodyDocId: 'wrong-body', status: 'active' });
  await assert.rejects(cloud.stage(record), { code: 'invalid_template' });
  respond({
    token: 'bad-scope',
    expiresIn: 30,
    gatewayBaseUrl: 'https://streams.example.test',
    streamId: 'workspace:meta',
  });
  await assert.rejects(cloud.getStreamToken({ kind: 'body', bodyDocId: 'body' }, false), {
    code: 'forbidden',
  });
});

test('a reopened caller-owned store recovers the same frozen publication identity and bytes', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { FileSystemStorageAdaptor } = await import('loro-repo/storage/filesystem');
  const path = await mkdtemp(join(tmpdir(), 'lody-sdk-shortcuts-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const repo = await LoroRepo.create({
    storageAdapter: new FileSystemStorageAdaptor({ baseDir: path }),
  });
  const store = await LocalShortcutStore.open({ repo, workspaceId: 'workspace', userId: 'user-a' });
  const record = await store.save({ value: shortcut(), bodyDocId: 'working', base: null });
  const frozen = await store.preparePublication(record.entry.id);
  await store.dispose();
  await repo.destroy();
  const reopenedRepo = await LoroRepo.create({
    storageAdapter: new FileSystemStorageAdaptor({ baseDir: path }),
  });
  const reopened = await LocalShortcutStore.open({
    repo: reopenedRepo,
    workspaceId: 'workspace',
    userId: 'user-a',
  });
  try {
    assert.deepEqual(reopened.publication(record.entry.id), frozen);
    assert.deepEqual(await reopened.preparePublication(record.entry.id), frozen);
    assert.deepEqual(await reopened.read(frozen.entry), shortcut());
  } finally {
    await reopened.dispose();
    await reopenedRepo.destroy();
  }
});

test('publication uploads the frozen body before activation and projects only after activation', async (t) => {
  const events = [];
  let state;
  const remote = noopRemote({
    stage: async (record) => {
      events.push(['stage', record.entry.bodyDocId]);
      return 'staged';
    },
    activate: async (record) => {
      events.push(['activate', record.entry.bodyDocId]);
      const index = await state.repo.acquireFlockDoc(getShortcutIndexStreamId(record.entry));
      try {
        assert.deepEqual(new PromptShortcutCatalog(index.flock).list(), []);
      } finally {
        await index.release();
      }
    },
    acquire: async (resource, write) => ({
      sync: async () => {
        events.push(['sync', resource, write]);
      },
      join: async () => {},
      release: async () => {},
    }),
    revoke: async (entry) => {
      events.push(['revoke', entry.id]);
    },
  });
  state = await fixture(t, remote);
  const entry = await state.runtime.save({
    value: shortcut({ visibility: 'workspace' }),
    bodyDocId: 'never-upload-working',
    base: null,
  });
  await state.runtime.flush();
  const published = state.store.get(entry.id).published;
  assert.notEqual(published.bodyDocId, 'never-upload-working');
  assert.deepEqual(events.slice(0, 2), [
    ['stage', published.bodyDocId],
    ['sync', { kind: 'body', bodyDocId: published.bodyDocId }, true],
  ]);
  assert.equal(
    events.some((row) => row[1]?.bodyDocId === 'never-upload-working'),
    false,
  );
  const index = await state.repo.acquireFlockDoc(getShortcutIndexStreamId(published));
  try {
    assert.deepEqual(new PromptShortcutCatalog(index.flock).list(), [published]);
  } finally {
    await index.release();
  }
  await state.runtime.remove(entry);
  await state.runtime.flush();
  assert.deepEqual(state.runtime.getSnapshot().entries, []);
  for (const visibility of ['private', 'workspace']) {
    const lease = await state.repo.acquireFlockDoc(
      getShortcutIndexStreamId({ ...entry, visibility }),
    );
    try {
      assert.equal(new PromptShortcutCatalog(lease.flock).get(entry.id).kind, 'deleted');
    } finally {
      await lease.release();
    }
  }
});
