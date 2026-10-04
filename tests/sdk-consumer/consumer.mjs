import assert from 'node:assert/strict';
import process from 'node:process';

import {
  createLodyClient,
  decodeBinary,
  encodeBinary,
  IdentityService,
  LodySdkError,
  OfflineDataRuntime,
  OfflineDocumentService,
  StreamsService,
  WorkspaceService,
} from '@lody-mobile/sdk';

async function main() {
  for (const name of ['React', 'chrome', 'Expo', 'window', 'document']) {
    assert.equal(globalThis[name], undefined);
  }
  for (const name of ['react', 'react-native', 'expo']) {
    assert.throws(() => import.meta.resolve(name), { code: 'ERR_MODULE_NOT_FOUND' });
  }
  let calls = 0;
  const client = createLodyClient({
    authOrigin: 'https://synthetic.example.test',
    clientId: 'synthetic-client',
    transport: async () => {
      calls++;
      return { status: 200, json: async () => ({ token: 'synthetic-grant', expiresIn: 10 }) };
    },
  });
  assert.equal(calls, 0);
  assert.ok(client.identity instanceof IdentityService);
  assert.ok(client.workspaces instanceof WorkspaceService);
  assert.ok(client.streams instanceof StreamsService);
  assert.equal(client.getStreamsGrant, client.streams.getGrant);
  assert.equal(client.getAccount, client.identity.getAccount);
  assert.equal(client.listWorkspaces, client.workspaces.list);
  assert.deepEqual(await client.getStreamsGrant('synthetic-credential', 'synthetic-workspace'), {
    token: 'synthetic-grant',
    expiresIn: 10,
  });
  assert.equal(calls, 1);
  assert.equal(new LodySdkError('cancelled').code, 'cancelled');
  for (const path of ['src/client.js', 'dist/client.js', 'dist/index.js', 'package.json']) {
    await assert.rejects(import(`@lody-mobile/sdk/${path}`), {
      code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    });
  }
  let context;
  let disposed = false;
  const runtime = new OfflineDataRuntime({
    start(value) {
      context = value;
      context.receive(
        JSON.stringify({
          protocol: 3,
          instanceId: context.instanceId,
          type: 'ready',
          environment: { origin: null, userAgent: 'sdk-package-consumer' },
        }),
      );
    },
    send(text) {
      const request = JSON.parse(text);
      assert.equal(request.rpc.m, 'open');
      assert.deepEqual(request.rpc.a, [{ documentId: 'synthetic', kind: 'flock' }]);
      context.receive(
        JSON.stringify({
          protocol: request.protocol,
          instanceId: request.instanceId,
          type: 'rpc',
          rpc: { t: 's', i: request.rpc.i, r: null },
        }),
      );
    },
    dispose() {
      disposed = true;
    },
  });
  try {
    assert.ok(runtime instanceof OfflineDocumentService);
    await runtime.ready;
    await runtime.data.open({ documentId: 'synthetic', kind: 'flock' });
  } finally {
    runtime.dispose();
  }
  assert.equal(disposed, true);
  assert.deepEqual(
    decodeBinary(encodeBinary(new Uint8Array([0, 102, 255]))),
    new Uint8Array([0, 102, 255]),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
