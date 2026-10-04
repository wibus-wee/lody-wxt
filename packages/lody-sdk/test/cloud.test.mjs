import assert from 'node:assert/strict';
import test from 'node:test';

import { CloudError, ConvexCloudDirectory } from '../dist/index.js';

test('cloud queries use explicit deployment and Convex JWT protocol', async () => {
  const calls = [];
  const cloud = new ConvexCloudDirectory({
    convexUrl: 'https://deployment.convex.cloud',
    jwt: { getJwt: async () => 'header.payload.signature' },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        status: 'success',
        value: [{ machineId: 'm', ownerUserId: 'u', sharedWithTeam: false, updatedAt: 1 }],
      });
    },
  });
  assert.equal((await cloud.listMachines('workspace'))[0].machineId, 'm');
  assert.equal(calls[0].url, 'https://deployment.convex.cloud/api/query');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer header.payload.signature');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    path: 'machines:listVisibleMachines',
    args: { workspaceId: 'workspace' },
    format: 'json',
  });
});

test('cloud rejects device bearer, malformed results and server errors', async () => {
  let token = 'device-bearer';
  let response = { status: 'success', value: [{ machineId: 'm' }] };
  let calls = 0;
  const cloud = new ConvexCloudDirectory({
    convexUrl: 'https://deployment.convex.cloud',
    jwt: { getJwt: async () => token },
    fetch: async () => {
      calls++;
      return Response.json(response);
    },
  });
  await assert.rejects(cloud.listMachines('w'));
  assert.equal(calls, 0);
  token = 'header.payload.signature';
  await assert.rejects(cloud.listMachines('w'));
  response = { status: 'error', errorMessage: 'not_authorized' };
  await assert.rejects(
    cloud.listMachines('w'),
    (error) => error instanceof CloudError && error.code === 'not_authorized',
  );
});
