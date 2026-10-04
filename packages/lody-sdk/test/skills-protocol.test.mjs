import assert from 'node:assert/strict';
import test from 'node:test';

import { SessionRuntime, StreamsMachineCommands } from '../dist/index.js';

function fixture(result) {
  let listener;
  const requests = [];
  const commands = new StreamsMachineCommands({
    workspaceId: 'workspace',
    streams: {
      ensure: async () => {},
      subscribe: async (_stream, next) => {
        listener = next;
      },
      append: async (_stream, request) => {
        requests.push(request);
        listener({ jsonrpc: '2.0', rpcVersion: '1', id: request.id, result });
      },
    },
  });
  return { runtime: new SessionRuntime({}, commands), commands, requests };
}
test('skill discovery sends the official nested workspace operation and retains truncated/error groups', async () => {
  const result = {
    ok: true,
    type: 'local-project/list-global-skills',
    result: {
      groups: [
        {
          scope: 'global',
          dir: '~/.agents/skills',
          skills: [
            {
              id: 'review',
              name: 'Review',
              relativePath: '~/.agents/skills/review/SKILL.md',
              isSymlink: false,
            },
          ],
          truncated: true,
        },
        {
          scope: 'system',
          dir: '~/.codex/skills/.system',
          skills: [],
          truncated: false,
          error: 'access denied',
        },
      ],
    },
  };
  const state = fixture(result);
  assert.deepEqual(
    await state.runtime.listSkills('machine', 'workspace', 'user', 'request'),
    result,
  );
  assert.deepEqual(state.requests[0].params, {
    request: {
      type: 'local-project/list-global-skills',
      machineId: 'machine',
      workspaceId: 'workspace',
      requestedByUserId: 'user',
    },
  });
  assert.equal(state.requests[0].method, 'local-project/control');
});
test('skill discovery rejects cross-workspace requests before I/O and mismatched response operation', async () => {
  const state = fixture({ ok: true, type: 'local-project/list-skills', result: { groups: [] } });
  await assert.rejects(
    state.runtime.listSkills('machine', 'other-workspace', 'user', 'request'),
    /request_identity_mismatch/,
  );
  assert.equal(state.requests.length, 0);
  await assert.rejects(
    state.runtime.listSkills('machine', 'workspace', 'user', 'request'),
    /response_identity_mismatch/,
  );
});
