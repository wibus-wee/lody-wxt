import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeManifests } from './merge.mjs';
import { shardCases, validateShardReport } from './shard.mjs';

const authored = Array.from({ length: 27 }, (_, index) => `journey/case-${index}`);
const identity = { id: 'run', candidateSha: 'sha', modelHash: 'model', sourceHash: 'source' };
const expected = { ...identity, webShards: 3 };
function lanes() {
  const base = { ...identity, authored, repeat: 1, startedAt: 'start', finishedAt: 'finish' };
  return [
    ...Array.from({ length: 3 }, (_, index) => ({
      ...base,
      lane: 'web',
      shard: { index, count: 3 },
      selected: shardCases(authored, index, 3),
      layers: { preparation: { exitCode: 0 }, web: { exitCode: 0 } },
    })),
    {
      ...base,
      lane: 'extension',
      layers: { preparation: { exitCode: 0 }, extension: { exitCode: 0 } },
    },
  ];
}
function report(keys) {
  return [
    {
      elements: keys.map((key) => {
        const [journey, variant] = key.split('/');
        return {
          type: 'scenario',
          tags: [{ name: `@journey:${journey}` }, { name: `@case:${variant}` }],
        };
      }),
    },
  ];
}
test('shards partition all authored cases exactly once, independently of discovery order', () => {
  const parts = [0, 1, 2].map((index) => shardCases(authored, index, 3));
  assert.deepEqual(
    parts.map((part) => part.length),
    [9, 9, 9],
  );
  assert.deepEqual(parts.flat().sort(), [...authored].sort());
  assert.deepEqual(shardCases([...authored].reverse(), 1, 3), parts[1]);
  for (const [index, count] of [
    [-1, 3],
    [3, 3],
    [0, 0],
    [0, 17],
    [0, 1.5],
  ])
    assert.throws(() => shardCases(authored, index, count));
  assert.throws(() => shardCases([], 0, 1));
  assert.throws(() => shardCases(['a', 'a'], 0, 1));
});
test('aggregate requires every matching shard and rejects an altered partition', () => {
  assert.equal(mergeManifests(lanes(), expected).laneReceipts.length, 4);
  assert.throws(() => mergeManifests(lanes().slice(1), expected));
  const duplicate = lanes();
  duplicate[1] = duplicate[0];
  assert.throws(() => mergeManifests(duplicate, expected));
  for (const mutation of [
    { shard: { index: 3, count: 3 } },
    { shard: { index: 0, count: 2 } },
    { selected: [] },
  ]) {
    const input = lanes();
    Object.assign(input[0], mutation);
    assert.throws(() => mergeManifests(input, expected));
  }
});
test('raw framework reports must contain exactly their assigned cases', () => {
  validateShardReport(report(authored), authored);
  assert.throws(() => validateShardReport(report(authored.slice(1)), authored));
  assert.throws(() => validateShardReport(report([...authored, authored[0]]), authored));
  assert.throws(() => validateShardReport(report(['foreign/case']), authored));
});
