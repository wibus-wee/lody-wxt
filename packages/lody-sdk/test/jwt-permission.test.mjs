import assert from 'node:assert/strict';
import test from 'node:test';

import { LoroDoc, LoroList, LoroMap } from 'loro-crdt';

import { BetterAuthConvexJwtProvider } from '../dist/index.js';
import { LoroSessionRepository } from '../dist/sessions/infrastructure/loro-session-repository.js';

test('session bearer is exchanged at Better Auth Convex endpoint before query use', async () => {
  let call;
  const provider = new BetterAuthConvexJwtProvider({
    authOrigin: 'https://auth.example',
    getSessionBearer: async () => 'session-token',
    fetch: async (url, init) => {
      call = { url, init };
      return Response.json({ token: 'header.payload.signature' });
    },
  });
  assert.equal(await provider.getJwt(), 'header.payload.signature');
  assert.equal(call.url, 'https://auth.example/api/auth/convex/token');
  assert.equal(call.init.method, 'GET');
  assert.equal(call.init.headers.Authorization, 'Bearer session-token');
  assert.equal(call.init.credentials, 'omit');
});

test('permission matches request and option and never overwrites a resolved outcome', async () => {
  const doc = new LoroDoc();
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
  const repo = new LoroSessionRepository({
    repo: {
      acquireDoc: async () => ({ doc, release: async () => {} }),
      joinDocRoom: async () => ({
        firstSyncedWithRemote: Promise.resolve(),
        waitUntilSynced: async () => {},
        unsubscribe() {},
      }),
      persistDocNow: async () => {},
    },
    metaRoom: { waitUntilSynced: async () => {} },
  });
  const handle = await repo.open('session');
  await assert.rejects(
    handle.respondPermission('assistant', 'permission', { outcome: 'selected', optionId: 'fake' }),
    /invalid_permission_option/,
  );
  assert.equal(request.get('outcome'), undefined);
  await handle.respondPermission('assistant', 'permission', {
    outcome: 'selected',
    optionId: 'allow',
  });
  assert.equal(request.toJSON().outcome.optionId, 'allow');
  await assert.rejects(
    handle.respondPermission('assistant', 'permission', { outcome: 'cancelled' }),
    /permission_already_resolved/,
  );
  await handle.close();
  await repo.close();
});
