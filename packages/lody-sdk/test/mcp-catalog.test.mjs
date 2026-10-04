import assert from 'node:assert/strict';
import test from 'node:test';

import { Flock } from '@loro-dev/flock-wasm';

import { WorkspaceMcpCatalog } from '../dist/loro-runtime.js';

function fixture() {
  const flock = new Flock();
  let released = 0;
  let unsubscribed = 0;
  let failSync = false;
  const catalog = new WorkspaceMcpCatalog({
    workspaceId: 'workspace1',
    repo: {
      acquireFlockDoc: async (id) => {
        assert.equal(id, 'workspace1:wf:workspace');
        return {
          flock,
          release: async () => {
            released++;
          },
        };
      },
      joinFlockDocRoom: async (id) => {
        assert.equal(id, 'workspace1:wf:workspace');
        return {
          firstSyncedWithRemote: failSync
            ? Promise.reject(new Error('catalog offline'))
            : Promise.resolve(),
          unsubscribe: () => {
            unsubscribed++;
          },
        };
      },
    },
  });
  return {
    flock,
    catalog,
    closed: () => [released, unsubscribed],
    fail: () => {
      failSync = true;
    },
  };
}
const entry = {
  id: 'research',
  name: 'Research',
  transport: 'http',
  description: 'Research documents',
  enabledByDefault: true,
  createdAt: 1,
  updatedAt: 2,
  connection: {
    transport: 'http',
    url: 'https://tools.example',
    bearerToken: 'private-token',
    headers: { Authorization: 'private-header' },
  },
};
test('MCP discovery syncs official workspace document, validates rows and returns no credentials', async () => {
  const f = fixture();
  f.flock.set(['mcpServer', 'research'], entry);
  f.flock.set(['agentRole', 'role'], { unrelated: true });
  f.flock.set(['mcpServer', 'missing'], {
    ...entry,
    id: 'missing',
    connection: undefined,
    enabledByDefault: false,
  });
  const result = await f.catalog.list();
  assert.deepEqual(
    result.find((server) => server.id === 'research'),
    {
      id: 'research',
      name: 'Research',
      transport: 'http',
      description: 'Research documents',
      enabledByDefault: true,
      hasConnection: true,
    },
  );
  assert.equal(result.find((server) => server.id === 'missing').hasConnection, false);
  assert.ok(!JSON.stringify(result).includes('private-'));
  assert.deepEqual(f.closed(), [1, 1]);
});
test('MCP discovery retains protocol identity and synchronization failures and releases both resources', async () => {
  const f = fixture();
  f.flock.set(['mcpServer', 'different'], entry);
  await assert.rejects(f.catalog.list(), /identity/);
  assert.deepEqual(f.closed(), [1, 1]);
  f.fail();
  await assert.rejects(f.catalog.list(), /catalog offline/);
  assert.deepEqual(f.closed(), [2, 2]);
});
