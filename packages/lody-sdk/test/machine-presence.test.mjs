import assert from 'node:assert/strict';
import test from 'node:test';

import { EphemeralStore } from 'loro-crdt';

import { MachinePresence } from '../dist/sessions/infrastructure/machine-presence.js';

function fixture() {
  let now = Date.now();
  let transportOptions;
  let onStatus;
  let rejoins = 0;
  let closed = 0;
  let unsubscribed = 0;
  const presence = new MachinePresence({
    workspaceId: 'workspace:a',
    baseUrl: 'https://streams.example',
    auth: async () => 'grant',
    now: () => now,
    createTransport: (options) => {
      transportOptions = options;
      return {
        join: async (options) => {
          onStatus = options.onStatusChange;
          return {
            ok: true,
            value: {
              unsubscribe: () => {
                unsubscribed++;
              },
            },
          };
        },
        rejoin: () => {
          rejoins++;
        },
        close: async () => {
          closed++;
        },
      };
    },
  });
  const writer = new EphemeralStore(90_000);
  return {
    presence,
    url: () => transportOptions.streamUrl,
    status: (status) => onStatus(status),
    advance: (ms) => {
      now += ms;
    },
    publish: async (entries) => {
      for (const [key, state] of Object.entries(entries))
        writer.set(key, { updatedAt: now, ...state });
      await transportOptions.adaptor.applyRemoteUpdates([writer.encodeAll()]);
    },
    rejoins: () => rejoins,
    closed: () => closed,
    unsubscribed: () => unsubscribed,
    close: async () => {
      await presence.close();
      writer.destroy();
    },
  };
}

test('machine status uses fresh ephemeral machine heartbeats and transport health', async () => {
  const f = fixture();
  try {
    const url = new URL(f.url());
    assert.equal(url.pathname, '/ds/lody/workspace%3Aa%3Ameta');
    assert.equal(url.searchParams.get('ephemeral'), 'presence');
    assert.equal(f.presence.getStatus('mac'), 'unknown');
    f.status('joined');
    assert.equal(f.presence.getStatus('mac'), 'offline');
    await f.publish({
      'machine:mac:old': { kind: 'machine', machineId: 'mac', instanceId: 'old', updatedAt: 1 },
      'session:active': { kind: 'session', machineId: 'session-only', instanceId: 'session' },
      malformed: { kind: 'machine', machineId: 'invalid', updatedAt: 'invalid' },
      'machine:mac:new': { kind: 'machine', machineId: 'mac', instanceId: 'new' },
    });
    assert.equal(f.presence.getStatus('mac'), 'online');
    assert.equal(f.presence.getStatus('session-only'), 'offline');
    assert.equal(f.presence.getStatus('invalid'), 'offline');
    f.advance(90_000);
    assert.equal(f.presence.getStatus('mac'), 'offline');
    f.status('reconnecting');
    assert.equal(f.presence.getStatus('mac'), 'unknown');
    f.status('joined');
    assert.equal(f.presence.getStatus('mac'), 'offline');
  } finally {
    await f.close();
  }
  assert.equal(f.presence.getStatus('mac'), 'unknown');
  assert.equal(f.closed(), 1);
  assert.equal(f.unsubscribed(), 1);
});

test('expiry ticks notify subscribers, retry stalled presence and stop after close', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = fixture();
  let notifications = 0;
  const unsubscribe = f.presence.subscribe(() => {
    notifications++;
  });
  try {
    f.advance(30_000);
    t.mock.timers.tick(30_000);
    assert.equal(f.rejoins(), 1);
    f.status('joined');
    await f.publish({ machine: { kind: 'machine', machineId: 'mac', instanceId: 'instance' } });
    assert.equal(f.presence.getStatus('mac'), 'online');
    const previous = notifications;
    f.advance(90_000);
    t.mock.timers.tick(30_000);
    assert.ok(notifications > previous);
    assert.equal(f.presence.getStatus('mac'), 'offline');
    assert.equal(f.rejoins(), 1);
    unsubscribe();
  } finally {
    await f.close();
  }
  const previous = notifications;
  t.mock.timers.tick(90_000);
  f.status('joined');
  assert.equal(notifications, previous);
  await f.presence.close();
  assert.equal(f.closed(), 1);
});
