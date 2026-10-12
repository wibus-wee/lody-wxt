import assert from 'node:assert/strict';
import { test } from 'node:test';

import { caseKey, findCase, modelHash } from './catalog.mjs';
import {
  assertReleaseSamples,
  compareBaseline,
  performanceGroups,
  promoteBaseline,
} from './performance.mjs';
import { auditEvidence } from './report.mjs';

const manifest = { id: 'isolated-run', sourceHash: 'source' };
const { journey, variant } = findCase('authorize-and-resume', 'durable');
const key = caseKey(journey.id, variant.id);
const authored = [{ key }];
const receipt = (overrides = {}) => ({
  runId: manifest.id,
  modelHash,
  sourceHash: manifest.sourceHash,
  journey: journey.id,
  case: variant.id,
  namespace: journey.namespace,
  layer: 'web',
  repetition: 1,
  status: 'passed',
  checkpoints: variant.obligations.map((id) => ({ id, observedAt: '2026-10-04T00:00:00Z' })),
  ...overrides,
});
const outcomes = new Map([
  [`web:1:${key}`, 'passed'],
  [`web:2:${key}`, 'passed'],
]);

test('successful tags cannot substitute for assertions or framework outcome', () => {
  assert.equal(
    auditEvidence([receipt({ checkpoints: [] })], manifest, authored, outcomes).get(key)[0].status,
    'incomplete',
  );
  assert.equal(auditEvidence([receipt()], manifest, authored).get(key)[0].status, 'incomplete');
  const failedHook = new Map([[`web:1:${key}`, 'failed']]);
  assert.equal(
    auditEvidence([receipt()], manifest, authored, failedHook).get(key)[0].status,
    'failed',
  );
});

test('checkpoints from separate attempts cannot certify the fused lifecycle', () => {
  const first = receipt({ checkpoints: [receipt().checkpoints[0]] });
  const second = receipt({ repetition: 2, checkpoints: receipt().checkpoints.slice(1) });
  const attempts = auditEvidence([first, second], manifest, authored, outcomes).get(key);
  assert.ok(attempts.every((attempt) => attempt.status === 'incomplete'));
});

test('foreign source/model receipts and preview-only packaged claims fail closed', () => {
  assert.throws(() =>
    auditEvidence([receipt({ sourceHash: 'old' })], manifest, authored, outcomes),
  );
  assert.throws(() => auditEvidence([receipt({ modelHash: 'old' })], manifest, authored, outcomes));
  const packaged = receipt({
    journey: 'capture-and-send-context',
    case: 'packaged-selection',
    namespace: 'pageContext',
  });
  assert.throws(() => auditEvidence([packaged], manifest, [], outcomes), /Packaged lifecycle/);
});

const sample = (durationMs, environment = { browser: 'controlled' }, status = 'observed') => ({
  id: 'send-feedback',
  durationMs,
  environment,
  status,
});
const measured = (interactions, status = 'passed') => ({
  status,
  interactions,
  trace: 'trace.zip',
});

test('hidden, timed-out and failed journeys cannot improve latency distributions', () => {
  const groups = performanceGroups([
    measured([sample(100), sample(1, undefined, 'hidden'), sample(1, undefined, 'timeout')]),
    measured([sample(1)], 'failed'),
    measured([sample(Number.NaN), sample(-1)]),
  ]);
  assert.deepEqual(groups[0].values, [100]);
  assert.equal(groups[0].excluded, 5);
  assert.equal(groups[0].p95Ms, 100);
});

test('regression comparisons require comparable environments and sufficient samples', () => {
  const group = (values, browser = 'controlled') =>
    performanceGroups([measured(values.map((value) => sample(value, { browser })))])[0];
  const original = group([100, 100, 100, 100, 100]);
  const baseline = promoteBaseline([original], { runId: 'baseline' });
  assert.equal(compareBaseline(group([151, 151, 151, 151, 151]), baseline).status, 'regression');
  assert.equal(
    compareBaseline(group([140, 140, 140, 140, 140]), baseline).status,
    'within baseline',
  );
  assert.equal(
    compareBaseline(group([100], 'new-browser'), baseline).status,
    'no comparable baseline',
  );
  assert.equal(compareBaseline(group([151]), baseline).status, 'insufficient samples');
  assert.throws(() => promoteBaseline([group([1])], {}), /Need 5/);
});

test('release requires every authored measurement and five comparable samples', () => {
  assert.throws(() => assertReleaseSamples([], ['send']));
  assert.throws(() => assertReleaseSamples([{ id: 'send', values: [1, 2, 3, 4] }], ['send']));
  assertReleaseSamples([{ id: 'send', values: [1, 2, 3, 4, 5] }], ['send']);
  assert.throws(() =>
    assertReleaseSamples([{ id: 'send', values: [1, 2, 3, 4, 5] }], ['send', 'stop']),
  );
});
