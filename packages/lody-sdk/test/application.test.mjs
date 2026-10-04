import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IdentityService,
  LodySdkError,
  OfflineDocumentService,
  StreamsService,
  WorkspaceService,
} from '../dist/index.js';

const code = {
  device_code: 'test-device',
  user_code: 'TEST',
  verification_uri: 'https://auth.test/device',
  verification_uri_complete: 'https://auth.test/device?code=TEST',
  expires_in: 60,
  interval: 2,
};

test('identity use case runs on a gateway port, anchors expiry before I/O and applies cumulative slowdown', async () => {
  let now = 1000;
  const waits = [];
  const exchanges = [];
  const replies = [
    { state: 'authorization_pending' },
    { state: 'slow_down' },
    { state: 'slow_down' },
    { state: 'authorized', token: { access_token: 'test-token' } },
  ];
  const gateway = {
    async requestDeviceCode() {
      now += 500;
      return code;
    },
    async requestDeviceToken(authorization) {
      exchanges.push(now);
      assert.equal(authorization.expiresAtMs, 61000);
      return replies.shift();
    },
    async getAccount() {
      throw new Error('unused');
    },
  };
  const clock = {
    now: () => now,
    async sleep(ms) {
      waits.push(ms);
      now += ms;
    },
  };
  const service = new IdentityService(gateway, clock);
  const authorization = await service.requestDeviceCode();
  assert.equal(authorization.expiresAtMs, 61000);
  assert.deepEqual(await service.waitForDeviceToken(authorization), { access_token: 'test-token' });
  assert.deepEqual(waits, [2000, 2000, 7000, 12000]);
  assert.deepEqual(exchanges, [3500, 5500, 12500, 24500]);
});

test('expired or cancelled identity flows cannot reach a gateway', async () => {
  let calls = 0;
  const service = new IdentityService(
    {
      async requestDeviceToken() {
        calls++;
      },
    },
    { now: () => 60000 },
  );
  const authorization = { code, expiresAtMs: 60000 };
  await assert.rejects(service.requestDeviceToken(authorization), { code: 'expired_token' });
  await assert.rejects(service.requestDeviceToken(authorization, { signal: AbortSignal.abort() }), {
    code: 'cancelled',
  });
  assert.equal(calls, 0);
});

test('an active device flow retains its original deadline when caller data changes', async () => {
  let now = 0;
  let calls = 0;
  const authorization = { code: { ...code }, expiresAtMs: 3000 };
  const service = new IdentityService(
    {
      async requestDeviceToken(input) {
        calls++;
        assert.equal(input.expiresAtMs, 3000);
        authorization.expiresAtMs = 60000;
        authorization.code.interval = 1;
        return { state: 'authorization_pending' };
      },
    },
    {
      now: () => now,
      async sleep(ms) {
        now += ms;
      },
    },
  );
  await assert.rejects(service.waitForDeviceToken(authorization), { code: 'expired_token' });
  assert.equal(calls, 1);
  assert.equal(now, 3000);
});

test('workspace and grant use cases validate inputs before invoking their ports', async () => {
  const calls = [];
  const workspaces = new WorkspaceService({
    async list(...args) {
      calls.push(args);
      return [];
    },
  });
  const streams = new StreamsService({
    async getGrant(...args) {
      calls.push(args);
      return { token: 'grant', expiresIn: 20 };
    },
  });
  await assert.rejects(workspaces.list(''), { code: 'invalid_argument' });
  await assert.rejects(streams.getGrant('account', 'invalid:id'), { code: 'invalid_argument' });
  await assert.rejects(streams.getGrant('account', 'workspace', { rejectedToken: '' }), {
    code: 'invalid_argument',
  });
  assert.equal(calls.length, 0);
  assert.deepEqual(await workspaces.list('account'), []);
  await streams.getGrant('account', ' workspace ', { rejectedToken: 'old-grant' });
  assert.deepEqual(calls, [
    ['account', {}],
    ['account', 'workspace', { rejectedToken: 'old-grant' }],
  ]);
});

test('offline document subscriptions work through a session port and release state on host closure', async () => {
  let receive, close;
  const session = {
    instanceId: 'test-session',
    data: {},
    closed: false,
    available: false,
    ready: Promise.resolve({ origin: null, userAgent: null }),
    onChange(listener) {
      receive = listener;
      return () => {};
    },
    onClose(listener) {
      close = listener;
      return () => {};
    },
    dispose() {
      this.closed = true;
      this.available = false;
      close();
    },
  };
  const service = new OfflineDocumentService(session);
  assert.throws(() => service.subscribe('meta', () => {}), /not_ready/);
  session.available = true;
  const revisions = [];
  service.subscribe('meta', () => {
    throw new Error('consumer-failure');
  });
  service.subscribe('meta', (change) => {
    change.documentId = 'other';
    change.revision = 99;
  });
  const unsubscribe = service.subscribe('meta', (change) => revisions.push(change.revision));
  for (const revision of [2, 1, 2, 3]) receive({ documentId: 'meta', revision });
  assert.deepEqual(revisions, [2, 3]);
  unsubscribe();
  unsubscribe();
  receive({ documentId: 'meta', revision: 4 });
  service.subscribe('meta', (change) => revisions.push(change.revision));
  unsubscribe();
  receive({ documentId: 'meta', revision: 5 });
  assert.deepEqual(revisions, [2, 3, 5]);
  session.dispose();
  receive({ documentId: 'meta', revision: 6 });
  assert.deepEqual(revisions, [2, 3, 5]);
  assert.equal(service.closed, true);
  assert.throws(() => service.subscribe('meta', () => {}), /not_ready/);
  assert.equal(new LodySdkError('cancelled').cause, undefined);
});
