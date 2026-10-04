import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { createLodyClient, LodySdkError } from '../dist/index.js';

const flush = () => setImmediate();

class FakeClock {
  time = 0;
  pending = new Set();
  waits = [];
  now = () => this.time;
  sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error('synthetic abort'));
      this.waits.push(ms);
      const entry = { at: this.time + ms, finish: undefined };
      let abort;
      const cleanup = () => {
        this.pending.delete(entry);
        signal.removeEventListener('abort', abort);
      };
      abort = () => {
        cleanup();
        reject(new Error('synthetic abort'));
      };
      entry.finish = () => {
        cleanup();
        resolve();
      };
      this.pending.add(entry);
      signal.addEventListener('abort', abort, { once: true });
    });
  async advance(ms) {
    this.time += ms;
    for (const entry of [...this.pending]) if (entry.at <= this.time) entry.finish();
    await flush();
  }
  async finish(promise) {
    let done = false;
    promise.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      },
    );
    for (let i = 0; i < 50; i++) {
      if (done) break;
      await flush();
      if (done) break;
      assert.ok(this.pending.size, 'operation stalled without a clock wait');
      await this.advance(Math.min(...Array.from(this.pending, (e) => e.at)) - this.time);
    }
    assert.ok(done, 'operation exceeded deterministic step bound');
    assert.equal(this.pending.size, 0, 'timers are released');
    return promise;
  }
}

const device = {
  device_code: 'synthetic-device-secret',
  user_code: 'TEST-CODE',
  verification_uri: 'https://auth.example.test/device',
  verification_uri_complete: 'https://auth.example.test/device?user_code=TEST-CODE',
  expires_in: 60,
  interval: 2,
};
const token = {
  access_token: 'synthetic-account-secret',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: 'test',
};
const account = {
  user: {
    id: 'user-1',
    email: 'test@example.test',
    name: 'Test',
    image: null,
    emailVerified: true,
  },
  session: {
    id: 'session-1',
    userId: 'user-1',
    token: 'synthetic-account-secret',
    expiresAt: '2099-01-01T00:00:00.000Z',
    activeOrganizationId: null,
  },
};
const workspace = {
  id: 'workspace-1',
  name: 'Test',
  slug: 'test',
  logo: null,
  metadata: { synthetic: true },
};
const grant = {
  token: 'synthetic-streams-secret',
  expiresIn: 300,
  gatewayBaseUrl: 'https://gateway.example.test',
  shardHostSuffix: 'streams.example.test',
};
const response = (data, status = 200) => ({ status, json: async () => data });

function setup(replies, overrides = {}) {
  const clock = new FakeClock();
  const calls = [];
  const client = createLodyClient({
    authOrigin: 'https://auth.example.test',
    clientId: 'synthetic-client',
    clock,
    transport: async (url, request) => {
      calls.push({ url, request, at: clock.now() });
      assert.ok(replies.length, 'unexpected additional request');
      const next = replies.shift();
      return typeof next === 'function' ? next(url, request) : next;
    },
    ...overrides,
  });
  return { client, clock, calls };
}

function fails(code, status) {
  return (error) => {
    assert.ok(error instanceof LodySdkError);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    const serialized = `${error.stack} ${JSON.stringify(error)}`;
    for (const secret of [
      'synthetic-device-secret',
      'synthetic-account-secret',
      'synthetic-streams-secret',
      'RAW-SENSITIVE',
    ]) {
      assert.ok(!serialized.includes(secret));
    }
    assert.equal(error.cause, undefined);
    return true;
  };
}

test('Device Flow preserves fields and transmits configured origin/client/grant type without cookies', async () => {
  const { client, clock, calls } = setup([
    response({ ...device, extension: true }),
    response({ error: 'authorization_pending' }, 400),
    response(token),
  ]);
  const authorization = await client.requestDeviceCode();
  assert.equal(authorization.expiresAtMs, 60_000);
  assert.equal(authorization.code.extension, true);
  assert.deepEqual(await clock.finish(client.waitForDeviceToken(authorization)), token);
  assert.deepEqual(
    calls.map((c) => c.at),
    [0, 2000, 4000],
  );
  assert.equal(calls[0].url, 'https://auth.example.test/api/auth/device/code');
  assert.deepEqual(JSON.parse(calls[0].request.body), { client_id: 'synthetic-client' });
  assert.equal(calls[1].url, 'https://auth.example.test/api/auth/device/token');
  assert.deepEqual(JSON.parse(calls[1].request.body), {
    client_id: 'synthetic-client',
    device_code: device.device_code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  for (const { request } of calls) {
    assert.equal(request.credentials, 'omit');
    assert.equal(request.redirect, 'error');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.Authorization, undefined);
  }
});

test('slow_down adds five seconds cumulatively to all subsequent intervals', async () => {
  const { client, clock, calls } = setup([
    response({ error: 'slow_down' }, 400),
    response({ error: 'slow_down' }, 400),
    response({ error: 'authorization_pending' }, 400),
    response(token),
  ]);
  await clock.finish(client.waitForDeviceToken({ code: device, expiresAtMs: 60_000 }));
  assert.deepEqual(
    calls.map((c) => c.at),
    [2000, 9000, 21000, 33000],
  );
});

for (const code of [
  'access_denied',
  'expired_token',
  'invalid_client',
  'invalid_grant',
  'invalid_request',
]) {
  test(`Device Flow terminates on ${code} without retry or sensitive error text`, async () => {
    const { client, clock, calls } = setup([
      response({ error: code, error_description: 'RAW-SENSITIVE' }, 400),
    ]);
    const promise = client.waitForDeviceToken({ code: device, expiresAtMs: 60_000 });
    const assertion = assert.rejects(promise, fails(code, 400));
    await clock.finish(assertion);
    assert.equal(calls.length, 1);
  });
}

test('local deadline stops polling and is not renewed by a delayed browser handoff', async () => {
  const { client, clock, calls } = setup([
    response(device),
    response({ error: 'authorization_pending' }, 400),
  ]);
  const authorization = await client.requestDeviceCode();
  await clock.advance(57_000);
  await clock.finish(
    assert.rejects(client.waitForDeviceToken(authorization), fails('expired_token')),
  );
  assert.deepEqual(
    calls.map((c) => c.at),
    [0, 59000],
  );
  await assert.rejects(client.requestDeviceToken(authorization), fails('expired_token'));
  assert.equal(calls.length, 2);
});

test('deadline also bounds an in-flight token request and rejects late success', async () => {
  let release;
  const { client, clock, calls } = setup([
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  ]);
  const promise = client.waitForDeviceToken({ code: device, expiresAtMs: 3000 });
  const assertion = assert.rejects(promise, fails('expired_token'));
  await clock.advance(2000);
  await clock.advance(1000);
  await assertion;
  assert.equal(calls[0].request.signal.aborted, true);
  release(response(token));
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(clock.pending.size, 0);
});

test('cancel waiting before the first poll and release its timer', async () => {
  const { client, clock, calls } = setup([]);
  const controller = new AbortController();
  const assertion = assert.rejects(
    client.waitForDeviceToken({ code: device, expiresAtMs: 60_000 }, { signal: controller.signal }),
    fails('cancelled'),
  );
  await flush();
  controller.abort('RAW-SENSITIVE');
  await assertion;
  assert.equal(calls.length, 0);
  assert.equal(clock.pending.size, 0);
});

test('cancel request even when the injected transport ignores abort', async () => {
  let release;
  const { client, clock, calls } = setup([
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  ]);
  const controller = new AbortController();
  const assertion = assert.rejects(
    client.getAccount(token.access_token, { signal: controller.signal }),
    fails('cancelled'),
  );
  await flush();
  controller.abort('RAW-SENSITIVE');
  await assertion;
  assert.equal(calls[0].request.signal.aborted, true);
  release(response(account));
  await flush();
  assert.equal(clock.pending.size, 0);
});

test('cancel an in-flight device poll without making another exchange', async () => {
  const { client, clock, calls } = setup([() => new Promise(() => {})]);
  const controller = new AbortController();
  const assertion = assert.rejects(
    client.waitForDeviceToken({ code: device, expiresAtMs: 60_000 }, { signal: controller.signal }),
    fails('cancelled'),
  );
  await clock.advance(2000);
  controller.abort();
  await assertion;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.signal.aborted, true);
  assert.equal(clock.pending.size, 0);
});

test('pre-aborted signal prevents any HTTP request', async () => {
  const { client, calls } = setup([]);
  await assert.rejects(
    client.requestDeviceCode({ signal: AbortSignal.abort() }),
    fails('cancelled'),
  );
  assert.equal(calls.length, 0);
});

test('request timeout stops polling without automatically retrying', async () => {
  const { client, clock, calls } = setup([() => new Promise(() => {})], { requestTimeoutMs: 100 });
  await clock.finish(
    assert.rejects(
      client.waitForDeviceToken({ code: device, expiresAtMs: 60_000 }),
      fails('timeout'),
    ),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.signal.aborted, true);
});

test('long polling intervals are chunked without sending an early exchange', async () => {
  const { client, clock, calls } = setup([response(token)]);
  const authorization = {
    code: { ...device, interval: 3_000_000, expires_in: 4_000_000 },
    expiresAtMs: 4_000_000_000,
  };
  await clock.finish(client.waitForDeviceToken(authorization));
  assert.equal(calls[0].at, 3_000_000_000);
});

test('timeout and cancellation also bound JSON body decoding', async () => {
  for (const cancel of [false, true]) {
    const { client, clock } = setup([{ status: 200, json: () => new Promise(() => {}) }]);
    const controller = new AbortController();
    const assertion = assert.rejects(
      client.getAccount(token.access_token, { signal: controller.signal, timeoutMs: 100 }),
      fails(cancel ? 'cancelled' : 'timeout'),
    );
    await flush();
    if (cancel) controller.abort();
    else await clock.advance(100);
    await assertion;
    assert.equal(clock.pending.size, 0);
  }
});

for (const [name, reply, code, status] of [
  [
    'unknown device error',
    response({ error: 'RAW-SENSITIVE', error_description: 'RAW-SENSITIVE' }, 400),
    'device_authorization_failed',
    400,
  ],
  [
    'non-JSON success',
    {
      status: 200,
      json: async () => {
        throw new SyntaxError('RAW-SENSITIVE');
      },
    },
    'invalid_response',
    200,
  ],
  [
    'non-JSON pending',
    {
      status: 400,
      json: async () => {
        throw new SyntaxError('RAW-SENSITIVE');
      },
    },
    'invalid_response',
    400,
  ],
  ['server failure carrying fake success', response(token, 500), 'http_error', 500],
  [
    'server failure carrying fake pending',
    response({ error: 'authorization_pending' }, 500),
    'http_error',
    500,
  ],
  ['bad request carrying token', response(token, 400), 'invalid_response', 400],
  [
    'token plus error',
    response({ ...token, error: 'authorization_pending' }),
    'invalid_response',
    200,
  ],
  [
    'malformed token',
    response({ access_token: '', expires_in: -1 }),
    'invalid_response',
    undefined,
  ],
  ['array response', response([]), 'invalid_response', undefined],
  ['null response', response(null), 'invalid_response', undefined],
  ['auth revoked', response({ message: 'RAW-SENSITIVE' }, 401), 'unauthenticated', 401],
  ['forbidden', response({ message: 'RAW-SENSITIVE' }, 403), 'forbidden', 403],
]) {
  test(`device response: ${name}`, async () => {
    const { client, clock, calls } = setup([reply]);
    await clock.finish(
      assert.rejects(
        client.waitForDeviceToken({ code: device, expiresAtMs: 60_000 }),
        fails(code, status),
      ),
    );
    assert.equal(calls.length, 1);
  });
}

test('transport rejection is a redacted network error', async () => {
  const { client, calls } = setup([
    () => {
      throw new Error('RAW-SENSITIVE synthetic-account-secret');
    },
  ]);
  await assert.rejects(client.requestDeviceCode(), fails('network_error'));
  assert.equal(calls.length, 1);
});

test('default global fetch receives the same configured transport contract', async (context) => {
  const clock = new FakeClock();
  const mock = context.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url, 'https://auth.example.test/api/loro-streams/token');
    assert.equal(request.headers.get('Authorization'), `Bearer ${token.access_token}`);
    assert.equal(request.redirect, 'error');
    assert.equal(request.credentials, 'omit');
    assert.deepEqual(JSON.parse(request.body), { workspaceId: workspace.id });
    return new Response(JSON.stringify(grant), { status: 200 });
  });
  const client = createLodyClient({
    authOrigin: 'https://auth.example.test',
    clientId: 'synthetic-client',
    clock,
  });
  assert.deepEqual(await client.getStreamsGrant(token.access_token, workspace.id), grant);
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(clock.pending.size, 0);
});

test('malformed transport response cannot escape the SDK error boundary', async () => {
  const { client } = setup([() => null]);
  await assert.rejects(client.getAccount(token.access_token), fails('invalid_response'));
});

test('default HTTP library never retries or decodes failure bodies before status classification', async (context) => {
  for (const [status, code] of [
    [400, 'http_error'],
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [503, 'http_error'],
  ]) {
    const mock = context.mock.method(globalThis, 'fetch', async () => ({
      status,
      body: true,
      json() {
        throw new Error('RAW-SENSITIVE body must not be read');
      },
    }));
    const client = createLodyClient({
      authOrigin: 'https://auth.example.test',
      clientId: 'synthetic-client',
    });
    await assert.rejects(client.getAccount(token.access_token), fails(code, status));
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});

test('account, organization, and Streams grant preserve authoritative and future fields', async () => {
  const { client, calls, clock } = setup([
    response(account),
    response([workspace]),
    response({ ...grant, extension: true }),
  ]);
  assert.deepEqual(await client.getAccount(token.access_token), account);
  assert.deepEqual(await client.listWorkspaces(token.access_token), [workspace]);
  assert.deepEqual(
    await client.getStreamsGrant(token.access_token, ' workspace-1 ', {
      rejectedToken: 'synthetic-old-grant',
    }),
    { ...grant, extension: true },
  );
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      'https://auth.example.test/api/auth/get-session',
      'https://auth.example.test/api/auth/organization/list',
      'https://auth.example.test/api/loro-streams/token',
    ],
  );
  assert.deepEqual(
    calls.map((c) => c.request.method),
    ['GET', 'GET', 'POST'],
  );
  assert.deepEqual(JSON.parse(calls[2].request.body), {
    workspaceId: 'workspace-1',
    rejectedToken: 'synthetic-old-grant',
  });
  for (const { request } of calls)
    assert.equal(request.headers.Authorization, `Bearer ${token.access_token}`);
  assert.equal(clock.pending.size, 0);
});

test('Convex Better Auth epoch dates normalize at the account and organization HTTP boundaries', async () => {
  const createdAt = 1_727_740_800_000;
  const updatedAt = createdAt + 60_000;
  const expiresAt = 4_070_908_800_000;
  const backendAccount = {
    user: { ...account.user, createdAt, updatedAt, userId: null },
    session: {
      ...account.session,
      createdAt,
      updatedAt,
      expiresAt,
      ipAddress: null,
      userAgent: null,
    },
  };
  const backendWorkspace = {
    ...workspace,
    createdAt,
    metadata: null,
    creatorUserId: null,
  };
  const { client } = setup([response(backendAccount), response([backendWorkspace])]);
  assert.deepEqual(await client.getAccount(token.access_token), {
    user: {
      ...backendAccount.user,
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(updatedAt).toISOString(),
    },
    session: {
      ...backendAccount.session,
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(updatedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    },
  });
  assert.deepEqual(await client.listWorkspaces(token.access_token), [
    { ...backendWorkspace, createdAt: new Date(createdAt).toISOString() },
  ]);
  assert.equal(backendAccount.session.expiresAt, expiresAt);
  assert.equal(backendWorkspace.createdAt, createdAt);
});

test('Better Auth dates reject malformed epochs and preserve ISO responses', async () => {
  for (const invalid of [null, '1727740800000', Infinity, Number.NaN, 0.5, 8_640_000_000_000_001]) {
    const { client } = setup([
      response({ ...account, user: { ...account.user, createdAt: invalid } }),
      response({ ...account, session: { ...account.session, expiresAt: invalid } }),
      response([{ ...workspace, createdAt: invalid }]),
    ]);
    await assert.rejects(client.getAccount(token.access_token), fails('invalid_response'));
    await assert.rejects(client.getAccount(token.access_token), fails('invalid_response'));
    await assert.rejects(client.listWorkspaces(token.access_token), fails('invalid_response'));
  }
  const iso = '2024-10-01T00:00:00.000Z';
  const isoAccount = {
    user: { ...account.user, createdAt: iso, updatedAt: iso },
    session: { ...account.session, createdAt: iso, updatedAt: iso },
  };
  const { client } = setup([response(isoAccount), response([{ ...workspace, createdAt: iso }])]);
  assert.deepEqual(await client.getAccount(token.access_token), isoAccount);
  assert.deepEqual(await client.listWorkspaces(token.access_token), [
    { ...workspace, createdAt: iso },
  ]);
});

test('grant routing fields are optional and no gateway/expiry is invented', async () => {
  const { client } = setup([response({ token: grant.token, expiresIn: 15 })]);
  assert.deepEqual(await client.getStreamsGrant(token.access_token, workspace.id), {
    token: grant.token,
    expiresIn: 15,
  });
});

test('no cache: concurrent credential contexts stay separate and old failures mutate nothing', async () => {
  let rejectOld;
  const { client, calls } = setup([
    () =>
      new Promise((_, reject) => {
        rejectOld = reject;
      }),
    response(grant),
    response(grant),
  ]);
  const old = assert.rejects(
    client.getStreamsGrant('old-account', 'old-workspace'),
    fails('network_error'),
  );
  const fresh = await client.getStreamsGrant('new-account', 'new-workspace');
  rejectOld(new Error('RAW-SENSITIVE'));
  await old;
  assert.deepEqual(await client.getStreamsGrant('new-account', 'new-workspace'), fresh);
  assert.deepEqual(
    calls.map((c) => c.request.headers.Authorization),
    ['Bearer old-account', 'Bearer new-account', 'Bearer new-account'],
  );
  assert.deepEqual(
    calls.map((c) => JSON.parse(c.request.body).workspaceId),
    ['old-workspace', 'new-workspace', 'new-workspace'],
  );
});

for (const [name, data, method, code] of [
  ['null session', null, 'getAccount', 'unauthenticated'],
  ['missing user', { session: account.session }, 'getAccount', 'invalid_response'],
  [
    'mismatched session owner',
    { ...account, session: { ...account.session, userId: 'other' } },
    'getAccount',
    'invalid_response',
  ],
  [
    'bad expiry',
    { ...account, session: { ...account.session, expiresAt: 'invalid' } },
    'getAccount',
    'invalid_response',
  ],
  [
    'bad user optional field',
    { ...account, user: { ...account.user, emailVerified: 'true' } },
    'getAccount',
    'invalid_response',
  ],
  ['non-array workspaces', {}, 'listWorkspaces', 'invalid_response'],
  ['incomplete workspace', [{ id: 'workspace-1' }], 'listWorkspaces', 'invalid_response'],
  ['missing grant expiry', { token: grant.token }, 'getStreamsGrant', 'invalid_response'],
  ['fractional grant expiry', { ...grant, expiresIn: 1.5 }, 'getStreamsGrant', 'invalid_response'],
  [
    'insecure gateway',
    { ...grant, gatewayBaseUrl: 'http://gateway.test' },
    'getStreamsGrant',
    'invalid_response',
  ],
  [
    'gateway credentials',
    { ...grant, gatewayBaseUrl: 'https://secret@gateway.test' },
    'getStreamsGrant',
    'invalid_response',
  ],
  [
    'gateway query',
    { ...grant, gatewayBaseUrl: 'https://gateway.test/?token=secret' },
    'getStreamsGrant',
    'invalid_response',
  ],
  [
    'bad shard host',
    { ...grant, shardHostSuffix: 'https://streams.test' },
    'getStreamsGrant',
    'invalid_response',
  ],
  [
    'bad shard label',
    { ...grant, shardHostSuffix: '-bad.streams.test' },
    'getStreamsGrant',
    'invalid_response',
  ],
]) {
  test(`validate ${name}`, async () => {
    const { client } = setup([response(data)]);
    await assert.rejects(client[method](token.access_token, workspace.id), fails(code));
  });
}

test('authentication status is classified before parsing a non-JSON failure body', async () => {
  for (const method of ['getAccount', 'listWorkspaces', 'getStreamsGrant']) {
    for (const [status, code] of [
      [401, 'unauthenticated'],
      [403, 'forbidden'],
      [503, 'http_error'],
    ]) {
      const { client } = setup([
        {
          status,
          json: () => {
            throw new Error('body must not be read');
          },
        },
      ]);
      await assert.rejects(client[method](token.access_token, workspace.id), fails(code, status));
    }
  }
});

test('device code validates lifetimes, browser URL scheme and retains original URI', async () => {
  for (const patch of [
    { interval: 0 },
    { expires_in: Number.NaN },
    { expires_in: 0.5 },
    { device_code: '' },
    { verification_uri: 'javascript:alert(1)' },
    { verification_uri_complete: 'https://secret@auth.test/device' },
  ]) {
    const { client } = setup([response({ ...device, ...patch })]);
    await assert.rejects(client.requestDeviceCode(), fails('invalid_response'));
  }
  const { client } = setup([response(device)]);
  assert.equal(
    (await client.requestDeviceCode()).code.verification_uri_complete,
    device.verification_uri_complete,
  );
});

test('request Device Code reports an unregistered client without retry', async () => {
  const { client, calls } = setup([
    response({ error: 'invalid_client', error_description: 'RAW-SENSITIVE' }, 400),
  ]);
  await assert.rejects(client.requestDeviceCode(), fails('invalid_client', 400));
  assert.equal(calls.length, 1);
});

test('invalid config and arguments fail before transport; clientId has no fabricated default', async () => {
  for (const overrides of [
    { clientId: '' },
    { clientId: undefined },
    { authOrigin: 'http://auth.test' },
    { authOrigin: 'https://secret@auth.test' },
    { authOrigin: 'https://auth.test/path' },
    { requestTimeoutMs: 0 },
    { requestTimeoutMs: Infinity },
  ])
    assert.throws(() => setup([], overrides), fails('invalid_configuration'));
  const { client, calls } = setup([]);
  await assert.rejects(client.getAccount(''), fails('invalid_argument'));
  await assert.rejects(client.getAccount('token\r\nHeader: value'), fails('invalid_argument'));
  await assert.rejects(client.requestDeviceCode({ timeoutMs: 0 }), fails('invalid_argument'));
  await assert.rejects(
    client.getStreamsGrant(token.access_token, 'bad:workspace'),
    fails('invalid_argument'),
  );
  await assert.rejects(
    client.getStreamsGrant(token.access_token, workspace.id, { rejectedToken: '' }),
    fails('invalid_argument'),
  );
  assert.equal(calls.length, 0);
});
