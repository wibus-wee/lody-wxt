import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { build } from 'esbuild';

import { DATA_PROTOCOL, decodeBinary, encodeBinary, MAX_MESSAGE_BYTES } from '../dist/data-wire.js';
import { MAX_BINARY_BYTES, OfflineDataRuntime } from '../dist/index.js';

class Clock {
  sleeps = new Set();
  now() {
    return 0;
  }
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      let entry;
      const abort = () => {
        this.sleeps.delete(entry);
        signal.removeEventListener('abort', abort);
        reject(new Error('cancelled'));
      };
      entry = {
        ms,
        resolve: () => {
          this.sleeps.delete(entry);
          signal.removeEventListener('abort', abort);
          resolve();
        },
      };
      signal.addEventListener('abort', abort, { once: true });
      this.sleeps.add(entry);
    });
  }
  fire() {
    for (const entry of [...this.sleeps]) entry.resolve();
  }
}
class Host {
  requests = [];
  disposals = 0;
  start(context) {
    this.context = context;
  }
  send(text) {
    const message = JSON.parse(text);
    this.requests.push(
      DATA_PROTOCOL === 1
        ? message
        : { ...message, id: message.rpc.i, operation: message.rpc.m, args: message.rpc.a[0] },
    );
  }
  dispose() {
    this.disposals++;
  }
  emit(message) {
    this.context.receive(
      JSON.stringify({ protocol: DATA_PROTOCOL, instanceId: this.context.instanceId, ...message }),
    );
  }
  ready() {
    this.emit({ type: 'ready', environment: { origin: null, userAgent: null } });
  }
  reply(request, result = null, changes = {}) {
    if (DATA_PROTOCOL === 1)
      return this.emit({
        type: 'response',
        id: request.id,
        operation: request.operation,
        ok: true,
        result,
        ...changes,
      });
    const {
      operation = request.operation,
      ok = true,
      code,
      result: value = result,
      ...envelope
    } = changes;
    const rpc = {
      t: operation === request.operation ? 's' : 'q',
      i: request.id,
      ...(ok === false ? { e: DATA_PROTOCOL === 2 ? { code } : code } : { r: value }),
    };
    if (typeof ok !== 'boolean')
      rpc.e = DATA_PROTOCOL === 2 ? { code: 'invalid_response' } : 'invalid_response';
    this.emit({ type: 'rpc', rpc, ...envelope });
  }
}
// Only the A/B harness adapts the unpublished API; production has no legacy facade.
function methods(runtime) {
  return DATA_PROTOCOL === 3
    ? runtime.data
    : {
        open: (input, signal) => runtime.open(input.documentId, input.kind, { signal }),
        read: (input, signal) => runtime.read(input.documentId, { signal }),
      };
}
const closed = (runtime) =>
  DATA_PROTOCOL === 3 ? runtime.closed : runtime.state === 'disposed' || runtime.state === 'failed';
function setup() {
  const host = new Host();
  const clock = new Clock();
  const runtime = new OfflineDataRuntime(host, { clock });
  return { host, clock, runtime, data: methods(runtime) };
}
const rejects = (promise, message) =>
  assert.rejects(promise, (error) => (error.code ?? error.message) === message);
const validRead = { kind: 'flock', value: [], version: '', revision: 0 };

test('ready handshake and single host ownership', async () => {
  const { runtime, data, host, clock } = setup();
  await rejects(data.open({ documentId: 'meta', kind: 'flock' }), 'not_ready');
  host.ready();
  await runtime.ready;
  assert.equal(closed(runtime), false);
  assert.equal(clock.sleeps.size, 0);
  runtime.dispose();
  runtime.dispose();
  assert.equal(host.disposals, 1);
  await assert.rejects(data.read({ documentId: 'meta' }));
  assert.equal(closed(runtime), true);
});
test('ready handshake rejects a missing environment without substituting values', async () => {
  const { runtime, host } = setup();
  host.emit({ type: 'ready' });
  await assert.rejects(runtime.ready);
  assert.equal(host.disposals, 1);
  assert.equal(closed(runtime), true);
});

test('initialization failures and deadline release the host', async () => {
  for (const mode of ['failed', 'timeout', 'dispose', 'error']) {
    const { runtime, host, clock } = setup();
    if (mode === 'failed') host.emit({ type: 'failed' });
    if (mode === 'timeout') clock.fire();
    if (mode === 'dispose') runtime.dispose();
    if (mode === 'error') host.context.fail();
    await rejects(
      runtime.ready,
      mode === 'dispose' ? 'disposed' : mode === 'error' ? 'host_failed' : 'initialization_failed',
    );
    assert.equal(clock.sleeps.size, 0);
    assert.equal(host.disposals, 1);
    host.ready();
    assert.equal(closed(runtime), true);
  }
  const runtime = new OfflineDataRuntime({
    start() {
      throw new Error('private-detail');
    },
    dispose() {},
    send() {},
  });
  await rejects(runtime.ready, 'initialization_failed');
});
test('correlation accepts out of order replies', async () => {
  const { runtime, data, host } = setup();
  host.ready();
  const a = data.open({ documentId: 'meta', kind: 'flock' });
  const b = data.open({ documentId: 'session', kind: 'loro' });
  host.reply(host.requests[1]);
  host.reply(host.requests[0]);
  await Promise.all([a, b]);
  runtime.dispose();
});
test('cancelled calls drop late success and error', async () => {
  const { runtime, data, host } = setup();
  host.ready();
  const abort = new AbortController();
  const call = data.read({ documentId: 'meta' }, abort.signal);
  abort.abort();
  await rejects(call, 'cancelled');
  host.reply(host.requests[0], { bad: 'ignored' });
  host.reply(host.requests[0], null, { ok: false, code: 'host_failed' });
  assert.equal(closed(runtime), false);
  runtime.dispose();
});
test('disposal settles pending calls and fences old events', async () => {
  const old = setup();
  old.host.ready();
  let notices = 0;
  old.runtime.subscribe('meta', () => notices++);
  const pending = old.data.open({ documentId: 'meta', kind: 'flock' });
  old.runtime.dispose();
  await rejects(pending, 'disposed');
  const fresh = setup();
  fresh.host.ready();
  fresh.runtime.subscribe('meta', () => notices++);
  assert.notEqual(old.runtime.instanceId, fresh.runtime.instanceId);
  fresh.host.emit({
    type: 'change',
    instanceId: old.runtime.instanceId,
    documentId: 'meta',
    revision: 1,
  });
  old.host.reply(old.host.requests[0]);
  old.host.emit({ type: 'change', documentId: 'meta', revision: 2 });
  assert.equal(notices, 0);
  fresh.host.emit({ type: 'change', documentId: 'meta', revision: 1 });
  assert.equal(notices, 1);
  fresh.runtime.dispose();
});
test('subscriptions deduplicate and unsubscribe', () => {
  const { runtime, host } = setup();
  host.ready();
  let count = 0;
  runtime.subscribe('meta', () => {
    throw new Error('consumer');
  });
  const stop = runtime.subscribe('meta', () => count++);
  const event = { type: 'change', documentId: 'meta', revision: 1 };
  host.emit(event);
  host.emit(event);
  assert.equal(count, 1);
  stop();
  stop();
  host.emit({ ...event, revision: 2 });
  assert.equal(count, 1);
  runtime.dispose();
});
test('reentrant disposal stops later subscription listeners', () => {
  const { runtime, host } = setup();
  host.ready();
  let count = 0;
  runtime.subscribe('meta', () => runtime.dispose());
  runtime.subscribe('meta', () => count++);
  host.emit({ type: 'change', documentId: 'meta', revision: 1 });
  assert.equal(count, 0);
  assert.equal(host.disposals, 1);
});
test('invalid transport envelopes reject pending calls', async () => {
  for (const changes of [{ operation: 'wrong' }, { protocol: DATA_PROTOCOL + 1 }]) {
    const { data, host } = setup();
    host.ready();
    const a = data.read({ documentId: 'meta' });
    const b = data.open({ documentId: 'session', kind: 'loro' });
    host.reply(host.requests[0], null, changes);
    await Promise.all([rejects(a, 'invalid_response'), rejects(b, 'invalid_response')]);
    assert.equal(host.disposals, 1);
  }
});
test('matched responses require a valid result shape', async () => {
  for (const result of [
    { ...validRead, version: '!' },
    { kind: 'loro', version: '', revision: 1 },
  ]) {
    const { runtime, data, host } = setup();
    host.ready();
    const call = data.read({ documentId: 'meta' });
    host.reply(host.requests[0], result);
    await rejects(call, 'invalid_response');
    runtime.dispose();
  }
});
test('abort wins over subsequent disposal without waiting for a response', async () => {
  const { runtime, data, host } = setup();
  host.ready();
  const abort = new AbortController();
  const call = data.read({ documentId: 'meta' }, abort.signal);
  abort.abort();
  runtime.dispose();
  await rejects(call, 'cancelled');
});
test('unsupported operations and oversized messages fail explicitly', async () => {
  const { runtime, data, host } = setup();
  host.ready();
  const call = data.open({ documentId: 'meta', kind: 'flock' });
  host.reply(host.requests[0], null, { ok: false, code: 'unsupported_operation' });
  await rejects(call, 'unsupported_operation');
  runtime.dispose();
  for (const text of ['bad json', 'x'.repeat(MAX_MESSAGE_BYTES + 1)]) {
    const next = setup();
    next.host.context.receive(text);
    await rejects(next.runtime.ready, 'invalid_response');
  }
});
test('canonical binary encoding and size limit', () => {
  for (let length = 0; length < 30; length++) {
    const bytes = new Uint8Array(Array.from({ length }, (_, i) => i * 23));
    assert.equal(encodeBinary(bytes), Buffer.from(bytes).toString('base64'));
    assert.deepEqual(decodeBinary(encodeBinary(bytes)), bytes);
  }
  const max = new Uint8Array(MAX_BINARY_BYTES);
  assert.equal(decodeBinary(encodeBinary(max)).length, MAX_BINARY_BYTES);
  for (const input of ['!', 'Zg=', 'Zh==', 'Zm9=', 1]) assert.throws(() => decodeBinary(input));
  assert.throws(() => encodeBinary(new Uint8Array(MAX_BINARY_BYTES + 1)));
});
test('invalid outbound document inputs reject only their call and preserve a pending sibling', async () => {
  const { runtime, host } = setup();
  host.ready();
  const sibling = runtime.data.read({ documentId: 'meta' });
  try {
    for (const bytes of [
      '!',
      'Zh==',
      Buffer.alloc(MAX_BINARY_BYTES + 1).toString('base64'),
      'x'.repeat(MAX_MESSAGE_BYTES),
    ]) {
      await rejects(runtime.data.import({ documentId: 'meta', bytes }), 'invalid_input');
    }
    await rejects(runtime.data.open({ documentId: '', kind: 'loro' }), 'invalid_input');
    await rejects(runtime.data.open({ documentId: 'meta', kind: 'unsupported' }), 'invalid_input');
    await rejects(runtime.data.read({ documentId: '../meta' }), 'invalid_input');
    await rejects(runtime.data.export({ documentId: 'meta', from: '!' }), 'invalid_input');
    assert.equal(host.requests.length, 1);
    assert.equal(host.disposals, 0);
    assert.equal(runtime.closed, false);
    host.reply(host.requests[0], validRead);
    assert.deepEqual(await sibling, validRead);
    const maximum = runtime.data.import({
      documentId: 'meta',
      bytes: encodeBinary(new Uint8Array(MAX_BINARY_BYTES)),
    });
    host.reply(host.requests[1], null);
    assert.equal(await maximum, null);
  } finally {
    runtime.dispose();
  }
});
test('pending capacity is bounded', async () => {
  const { runtime, data, host } = setup();
  host.ready();
  // Each slot must start a separate pending RPC; fill would repeat one promise.
  // eslint-disable-next-line e18e/prefer-array-fill
  const calls = Array.from({ length: 64 }, () => data.read({ documentId: 'meta' }));
  await rejects(data.read({ documentId: 'meta' }), 'limit_exceeded');
  runtime.dispose();
  await Promise.all(calls.map((call) => rejects(call, 'disposed')));
});
test('one cancellation leaves its sibling usable', async () => {
  const { runtime, data, host } = setup();
  host.ready();
  const abort = new AbortController();
  const a = data.read({ documentId: 'meta' }, abort.signal);
  const b = data.read({ documentId: 'meta' });
  abort.abort();
  await rejects(a, 'cancelled');
  host.reply(host.requests[0], { corrupt: true });
  host.reply(host.requests[0], null, { ok: false, code: 'host_failed' });
  host.reply(host.requests[1], validRead);
  assert.deepEqual((await b).value, []);
  assert.equal(closed(runtime), false);
  runtime.dispose();
});
test('repeated cancellation releases capacity', async () => {
  const { runtime, data, host } = setup();
  host.ready();
  for (let batch = 0; batch < 4; batch++) {
    // Independent controllers exercise cleanup for 64 separately cancelled calls.
    // eslint-disable-next-line e18e/prefer-array-fill
    const aborts = Array.from({ length: 64 }, () => new AbortController());
    const calls = aborts.map((abort) => data.read({ documentId: 'meta' }, abort.signal));
    for (const abort of aborts) abort.abort();
    await Promise.all(calls.map((call) => rejects(call, 'cancelled')));
  }
  const call = data.open({ documentId: 'meta', kind: 'flock' });
  host.reply(host.requests.at(-1));
  await call;
  runtime.dispose();
});
test('send failures close the host without exposing its exception', async () => {
  const { data, host } = setup();
  host.ready();
  host.send = () => {
    throw new Error('synthetic-private-detail');
  };
  await rejects(data.read({ documentId: 'meta' }), 'host_failed');
  assert.equal(host.disposals, 1);
});
test('old instances cannot answer a copied current correlation ID', async () => {
  const old = setup();
  old.host.ready();
  old.runtime.dispose();
  const fresh = setup();
  fresh.host.ready();
  const call = fresh.data.read({ documentId: 'meta' });
  const request = fresh.host.requests[0];
  fresh.host.reply(
    request,
    { ...validRead, value: ['old'] },
    { instanceId: old.runtime.instanceId },
  );
  fresh.host.reply(request, validRead);
  assert.deepEqual((await call).value, []);
  fresh.runtime.dispose();
});
test('a malformed payload rejects only its own call', { skip: DATA_PROTOCOL !== 3 }, async () => {
  const { runtime, data, host } = setup();
  host.ready();
  const bad = data.read({ documentId: 'meta' });
  const sibling = data.open({ documentId: 'meta', kind: 'flock' });
  host.reply(host.requests[0], { ...validRead, version: '!' });
  host.reply(host.requests[1]);
  await rejects(bad, 'invalid_response');
  await sibling;
  assert.equal(closed(runtime), false);
  runtime.dispose();
});
test(
  'birpc owns its default timeout and releases it on cancel and dispose',
  { skip: DATA_PROTOCOL !== 3 },
  async () => {
    const timers = new Set();
    const result = await build({
      stdin: {
        contents: "export { OfflineDataRuntime } from './data-runtime.js';",
        resolveDir: fileURLToPath(new URL('../dist/', import.meta.url)),
        sourcefile: 'data-runtime-fixture.js',
      },
      bundle: true,
      format: 'iife',
      globalName: 'Sdk',
      platform: 'browser',
      write: false,
    });
    const RuntimeContext = vm.createContext({
      AbortController,
      performance,
      setTimeout: (fn, ms) => {
        const timer = {
          fn: () => {
            timers.delete(timer);
            fn();
          },
          ms,
          unref: () => timer,
        };
        timers.add(timer);
        return timer;
      },
      clearTimeout: (timer) => timers.delete(timer),
    });
    vm.runInContext(result.outputFiles[0].text, RuntimeContext);
    const host = new Host();
    const clock = new Clock();
    const runtime = new RuntimeContext.Sdk.OfflineDataRuntime(host, { clock });
    host.ready();
    const abort = new AbortController();
    for (let i = 0; i < 65; i++)
      await rejects(runtime.data.read({ documentId: 'meta' }, {}), 'invalid_input');
    assert.equal(host.requests.length, 0);
    const read = runtime.data.read({ documentId: 'meta' });
    host.reply(host.requests[0], validRead);
    assert.equal(JSON.stringify(await read), JSON.stringify(validRead));
    assert.equal(timers.size, 0);
    const cancelled = runtime.data.read({ documentId: 'meta' }, abort.signal);
    assert.equal([...timers][0].ms, 60000);
    abort.abort();
    await rejects(cancelled, 'cancelled');
    assert.equal(timers.size, 0);
    const timed = runtime.data.read({ documentId: 'meta' });
    const [timer] = timers;
    timer.fn();
    await assert.rejects(timed, /timeout/);
    assert.equal(timers.size, 0);
    host.reply(host.requests.at(-1), { bad: 'late' });
    assert.equal(runtime.closed, false);
    const pending = runtime.data.read({ documentId: 'meta' });
    runtime.dispose();
    await rejects(pending, 'disposed');
    assert.equal(timers.size, 0);
  },
);
