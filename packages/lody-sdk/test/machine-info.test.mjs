import assert from 'node:assert/strict';
import test from 'node:test';

import { LoroRepo } from 'loro-repo';

import { MachineFlockDirectory } from '../dist/sessions/infrastructure/machine-flock.js';

test('real repo machine metadata exposes registration names and observes rename commits', async () => {
  const repo = await LoroRepo.create({ metaDebounceCommitMs: 0 });
  const directory = new MachineFlockDirectory({ repo, workspaceId: 'workspace' });
  try {
    await repo.upsertDocMeta('machine-mac', {
      id: 'mac',
      name: 'Wibus MacBook',
      cliVersion: '1.0',
      os: 'darwin',
      sessions: [],
    });
    assert.equal((await directory.listMachineInfos(['mac']))[0].name, 'Wibus MacBook');
    let changed;
    const observed = new Promise((resolve) => {
      changed = resolve;
    });
    const unsubscribe = directory.subscribeMachineInfos(changed);
    await repo.upsertDocMeta('machine-mac', { name: 'Work Mac' });
    await observed;
    assert.equal((await directory.listMachineInfos(['mac']))[0].name, 'Work Mac');
    unsubscribe();
  } finally {
    await directory.close();
    await repo.destroy();
  }
});

test('machine names come from root metadata and preserve absent names without opening rooms', async () => {
  let rows = [
    {
      docId: 'machine-mac',
      meta: {
        id: 'mac',
        name: 'Wibus MacBook',
        os: 'darwin',
        cliVersion: '1.0',
        sessions: [],
        futureField: true,
      },
    },
    { docId: 'machine-empty', meta: { id: 'empty' } },
    { docId: 'machine-deleted', deleted: true, meta: { id: 'deleted', name: 'Old machine' } },
    { docId: 'session-session', meta: { id: 'session', name: 'Session title' } },
    { docId: 'machine-hidden', meta: { id: 'hidden', name: 'Private machine' } },
  ];
  let listener;
  let unsubscribed = 0;
  const directory = new MachineFlockDirectory({
    workspaceId: 'workspace',
    repo: {
      listDoc: async () => rows,
      watch: (next) => {
        listener = next;
        return {
          unsubscribe: () => {
            unsubscribed++;
          },
        };
      },
      acquireFlockDoc: () => {
        throw new Error('Names must not acquire Flock docs');
      },
      joinFlockDocRoom: () => {
        throw new Error('Names must not join machine rooms');
      },
    },
  });
  const ids = ['mac', 'empty', 'deleted', 'missing'];
  assert.deepEqual(await directory.listMachineInfos(ids), [
    { id: 'mac', name: 'Wibus MacBook', os: 'darwin', cliVersion: '1.0' },
    { id: 'empty' },
    { id: 'deleted' },
    { id: 'missing' },
  ]);
  let refreshed;
  const unsubscribe = directory.subscribeMachineInfos(() => {
    refreshed = directory.listMachineInfos(ids);
  });
  rows = [{ docId: 'machine-mac', meta: { id: 'mac', name: 'Renamed Mac' } }];
  listener();
  assert.equal((await refreshed)[0].name, 'Renamed Mac');
  await directory.close();
  unsubscribe();
  assert.equal(unsubscribed, 1);
  await assert.rejects(directory.listMachineInfos(ids), /closed/);
});

test('machine metadata rejects conflicting identities and malformed names', async () => {
  let meta = { id: 'other', name: 'Name' };
  const directory = new MachineFlockDirectory({
    workspaceId: 'workspace',
    repo: {
      listDoc: async () => [{ docId: 'machine-mac', meta }],
    },
  });
  await assert.rejects(directory.listMachineInfos(['mac']), /identity mismatch/);
  meta = { id: 'mac', name: 42 };
  await assert.rejects(directory.listMachineInfos(['mac']));
  await directory.close();
});
