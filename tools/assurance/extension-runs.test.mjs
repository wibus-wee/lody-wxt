import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extensionRuns, collectExtensionOutcomes } from './extension-runs.mjs';
import { auditEvidence } from './report.mjs';
import { findCase, modelHash } from './catalog.mjs';
import { performanceGroups, assertReleaseSamples } from './performance.mjs';

test('release schedules five independent packaged executions without overwriting reports or traces', () => {
  const runs = extensionRuns(5, 'reports/run');
  assert.equal(runs.length, 5);
  assert.equal(new Set(runs.map((run) => run.env.ASSURANCE_EXTENSION_REPORT)).size, 5);
  assert.equal(new Set(runs.map((run) => run.args[4])).size, 5);
  assert.deepEqual(
    runs.map((run) => run.env.ASSURANCE_REPETITION),
    ['1', '2', '3', '4', '5'],
  );
  assert.equal(extensionRuns(1, 'reports/pr')[0].env.ASSURANCE_EXTENSION_REPORT, 'extension.json');
  assert.ok(extensionRuns(1, 'reports/pr', true)[0].args.includes('--max-failures=1'));
  for (const invalid of [0, 21, 1.5, NaN])
    assert.throws(() => extensionRuns(invalid, 'reports/run'));
});

const report = (status) => ({
  suites: [
    { suites: [{ specs: [{ id: 'appcast', tests: [{ results: status ? [{ status }] : [] }] }] }] },
  ],
});
test('five packaged samples bind to their own framework result; missing and failed rounds never certify', () => {
  const manifest = { id: 'release', sourceHash: 'source' };
  const { journey, variant } = findCase('discover-and-download-update', 'packaged-appcast');
  const records = Array.from({ length: 5 }, (_, index) => ({
    runId: manifest.id,
    modelHash,
    sourceHash: manifest.sourceHash,
    journey: journey.id,
    case: variant.id,
    namespace: journey.namespace,
    layer: 'extension',
    repetition: index + 1,
    frameworkId: 'appcast',
    status: 'passed',
    checkpoints: variant.obligations.map((id) => ({ id })),
    interactions: [
      {
        id: 'update-check',
        status: 'observed',
        durationMs: 20,
        environment: { browser: 'controlled' },
      },
    ],
  }));
  const outcomes = new Map();
  for (let repetition = 1; repetition <= 5; repetition++)
    collectExtensionOutcomes(report('passed'), repetition, outcomes);
  const audit = () =>
    auditEvidence(records, manifest, [], outcomes).get(`${journey.id}/${variant.id}`);
  assert.ok(audit().every((item) => item.status === 'verified'));
  assertReleaseSamples(performanceGroups(records), ['update-check']);
  outcomes.delete('extension:5:appcast');
  assert.equal(audit()[4].status, 'incomplete');
  collectExtensionOutcomes(report('timedOut'), 5, outcomes);
  assert.equal(audit()[4].status, 'failed');
  assert.throws(() => collectExtensionOutcomes(report('passed'), 5, outcomes), /Duplicate/);
  const empty = new Map();
  collectExtensionOutcomes(report(null), 1, empty);
  assert.equal(empty.get('extension:1:appcast'), 'incomplete');
});
