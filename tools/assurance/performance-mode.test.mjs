import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertReleaseSamples, performanceBlocks, releaseSampleFindings } from './performance.mjs';

const audit = { measurementFailures: [], performanceWarnings: [], performance: [] };
test('advisory release reports every missing and undersampled boundary', () => {
  const warnings = releaseSampleFindings(
    [
      { id: 'update-check', values: [1, 2, 3, 4] },
      { id: 'send-feedback', values: [1, 2, 3, 4, 5] },
    ],
    ['capture-preview', 'update-check', 'send-feedback'],
  );
  assert.deepEqual(warnings, [
    'Missing release measurement: capture-preview',
    'Incomplete release samples: update-check (4/5)',
  ]);
  const failing = { ...audit, performanceWarnings: warnings };
  assert.equal(performanceBlocks(failing), true);
  assert.equal(performanceBlocks(failing, 'report'), false);
  assert.equal(failing.performanceWarnings.length, 2);
});
test('report policy preserves invalid measurement and regression findings', () => {
  for (const failing of [
    { ...audit, measurementFailures: ['capture / attempt 1'] },
    { ...audit, performance: [{ comparison: { status: 'regression' } }] },
  ]) {
    assert.equal(performanceBlocks(failing, 'enforce'), true);
    assert.equal(performanceBlocks(failing, 'report'), false);
  }
  assert.equal(performanceBlocks(audit), false);
  assert.throws(() => performanceBlocks(audit, 'ignore-everything'), /Unknown performance mode/);
});

test('release sample completeness remains mandatory independently of advisory timing policy', () => {
  const ids = ['capture-preview', 'update-check'];
  const complete = ids.map((id) => ({ id, values: [1, 2, 3, 4, 5] }));
  assert.doesNotThrow(() => assertReleaseSamples(complete, ids));
  assert.throws(
    () => assertReleaseSamples(complete.slice(1), ids),
    /Missing release measurement: capture-preview/,
  );
  assert.throws(
    () => assertReleaseSamples([{ id: 'capture-preview', values: [1, 2, 3, 4] }, complete[1]], ids),
    /Incomplete release samples: capture-preview/,
  );
});
