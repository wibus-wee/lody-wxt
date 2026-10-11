import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeStrategyFindings } from './merge-strategy.mjs';

const queue = {
  type: 'merge_queue',
  parameters: { max_entries_to_build: 1, max_entries_to_merge: 1 },
};
test('strategies fail closed on unknown policy or unavailable branch rules', () => {
  for (const strategy of [undefined, null, '', 'auto'])
    assert.deepEqual(mergeStrategyFindings(strategy, []), ['UNKNOWN_MERGE_STRATEGY']);
  for (const strategy of ['protected-auto-merge', 'merge-queue'])
    for (const rules of [undefined, null, { blocked: true }])
      assert.deepEqual(mergeStrategyFindings(strategy, rules), ['MERGE_RULES_UNVERIFIED']);
});
test('personal strategy rejects every queue; queue strategy requires every queue to be single-entry', () => {
  assert.deepEqual(mergeStrategyFindings('protected-auto-merge', []), []);
  assert.deepEqual(mergeStrategyFindings('protected-auto-merge', [queue]), [
    'UNEXPECTED_MERGE_QUEUE',
  ]);
  assert.deepEqual(mergeStrategyFindings('merge-queue', [queue]), []);
  for (const rules of [
    [],
    [{ type: 'merge_queue' }],
    [queue, { ...queue, parameters: { max_entries_to_build: 2, max_entries_to_merge: 1 } }],
  ])
    assert.deepEqual(mergeStrategyFindings('merge-queue', rules), ['MERGE_QUEUE_REQUIRED']);
});
