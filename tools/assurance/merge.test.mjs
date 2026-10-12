import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeManifests } from './merge.mjs';

const expected = { id: 'run', sourceHash: 'source', modelHash: 'model', candidateSha: 'sha' };
function lanes() {
  return ['web', 'extension'].map((lane) => ({
    ...expected,
    lane,
    repeat: 1,
    authored: ['case'],
    startedAt: '2026-10-12T00:00:00Z',
    finishedAt: '2026-10-12T00:01:00Z',
    layers: { preparation: { exitCode: 0 }, [lane]: { exitCode: 0 } },
  }));
}
test('joins complete matching lanes without losing raw receipts', () => {
  const result = mergeManifests(lanes(), expected);
  assert.equal(result.laneReceipts.length, 2);
  assert.deepEqual(Object.keys(result.layers), ['preparation', 'web', 'extension']);
});
test('missing, duplicated, unfinished and failed lanes cannot pass', () => {
  assert.throws(() => mergeManifests(lanes().slice(0, 1), expected));
  assert.throws(() => mergeManifests([lanes()[0], lanes()[0]], expected));
  for (const change of [
    { finishedAt: null },
    { repeat: 0 },
    { authored: [] },
    { layers: { preparation: { exitCode: 0 }, extension: { exitCode: 1 } } },
    { layers: { extension: { exitCode: 0 } } },
  ]) {
    const input = lanes();
    Object.assign(input[1], change);
    assert.throws(() => mergeManifests(input, expected));
  }
});
test('foreign run, model, source and commit are rejected', () => {
  for (const field of Object.keys(expected)) {
    const input = lanes();
    input[1][field] = 'other';
    assert.throws(() => mergeManifests(input, expected), new RegExp(field));
  }
});
