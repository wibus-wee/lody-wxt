import assert from 'node:assert/strict';
import test from 'node:test';

import { acquireWithin } from '../dist/sessions/infrastructure/lifecycle.js';
import { MachineFlockDirectory } from '../dist/sessions/infrastructure/machine-flock.js';

test('late acquisition after abort releases its resource exactly once', async () => {
  let resolve;
  let releases = 0;
  const controller = new AbortController();
  const acquisition = new Promise((next) => {
    resolve = next;
  });
  const pending = acquireWithin(acquisition, controller.signal, async () => {
    releases++;
  });
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/);
  resolve({});
  await new Promise((next) => queueMicrotask(next));
  assert.equal(releases, 1);
});

test('directory closure releases machine rooms and subscriptions once', async () => {
  let unsubscribed = 0;
  let released = 0;
  let listeners = 0;
  const directory = new MachineFlockDirectory({
    workspaceId: 'w',
    repo: {
      acquireFlockDoc: async () => ({
        flock: {
          scanValues: () => [],
          subscribe: () => {
            listeners++;
            return () => {
              listeners--;
            };
          },
        },
        release: async () => {
          released++;
        },
      }),
      joinFlockDocRoom: async () => ({
        firstSyncedWithRemote: Promise.resolve(),
        unsubscribe: () => {
          unsubscribed++;
        },
      }),
    },
  });
  const machine = await directory.open('m');
  machine.subscribe(() => {});
  await directory.close();
  await machine.close();
  assert.equal(unsubscribed, 1);
  assert.equal(released, 1);
  assert.equal(listeners, 0);
  await assert.rejects(directory.open('m'));
});
