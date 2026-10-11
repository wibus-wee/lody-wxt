import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { validateReview } from './acceptance.mjs';
import { digest, parsePolicy, safePath } from './common.mjs';
import { validateContract } from './contract.mjs';
import { verifyEvidence } from './evidence.mjs';
import { classifyImpact } from './impact.mjs';

const policy = parsePolicy(
  readFileSync(new URL('../../.github/autonomous-maintenance-policy.yml', import.meta.url), 'utf8'),
);
const sha = 'a'.repeat(40);
const base = 'b'.repeat(40);
const hash = 'c'.repeat(64);
const model = {
  owners: { delivery: { source: ['src/delivery.ts'] } },
  journeys: [{ id: 'delivery', chain: ['delivery'], cases: [{ id: 'reconnect' }] }],
};
const change = {
  type: 'fix',
  summary: 'Preserve uncertain send',
  user_impact: 'One admission after reconnect',
  expected_path: 'Reconnect and resolve delivery',
  negative_path: 'Network ambiguity retains draft',
  release_note: 'Fix duplicate sends',
  breaking: false,
  surfaces: ['web', 'extension'],
  affected_journeys: ['delivery/reconnect'],
  added_or_updated_journeys: ['delivery/reconnect'],
  evidence: { e2e: true, packaged_extension: true, screenshots: [] },
  test_links: ['tests/e2e/features/concurrent-delivery.feature'],
};
const body = (intent) =>
  `<!-- autonomous-intent:start -->\n\`\`\`json\n${JSON.stringify({ change: intent })}\n\`\`\`\n<!-- autonomous-intent:end -->`;
const impact = classifyImpact(
  [{ filename: 'src/delivery.ts' }],
  policy,
  model,
  new Map([['src/delivery.ts', new Set(['web/main.tsx', 'src/entrypoints/sidepanel/main.tsx'])]]),
);
function decisionFixture() {
  const context = {
    repository: policy.repository,
    pr: 4,
    headSha: sha,
    prHeadSha: sha,
    baseSha: base,
    policyVersion: policy.version,
    change,
    impact,
    evidenceDigest: hash,
    evidenceExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const decision = {
    schemaVersion: 1,
    repository: policy.repository,
    pr: 4,
    headSha: sha,
    baseSha: base,
    policyVersion: policy.version,
    contextHash: digest(context),
    decision: 'ACCEPT',
    risk: 'normal',
    evidenceIds: [hash],
    blockingFindings: [],
    uncertainties: [],
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    adequacy: {
      sourceInputsVerified: true,
      dataSafetyReviewed: true,
      intentMatchesDiff: true,
      implicitImpactReviewed: true,
      fixturesDoNotShortcut: true,
      productionEntrypoints: true,
      authoritativeOutcomes: true,
      failurePathsReviewed: true,
      uiReviewed: true,
      uiCaptureVerified: true,
    },
    probes: [
      {
        journey: 'delivery/reconnect',
        headSha: sha,
        candidate: 'passed',
        regression: 'failed',
        infrastructureFailure: false,
        method: 'mutation',
        traceDigest: hash,
        oracle: 'Authoritative delivery count and restored history',
      },
    ],
  };
  return {
    context,
    decision,
  };
}
test('honest fix requires model cases and independent regression-detecting evidence', () => {
  assert.deepEqual(validateContract(body(change), impact, model), change);
  const fixture = decisionFixture();
  assert.equal(validateReview(fixture.decision, fixture.context).decision, 'ACCEPT');
});
test('docs-only change needs actual tooling links and explanation, no invented browser E2E', () => {
  const docs = classifyImpact(['docs/maintenance.md'], policy, model);
  assert.equal(docs.runtime, false);
  assert.equal(docs.ui, false);
  const intent = {
    ...change,
    type: 'docs',
    affected_journeys: [],
    added_or_updated_journeys: [],
    evidence: { e2e: false, packaged_extension: false, screenshots: [] },
    nonvisual_reason: 'Only contributor documentation changed',
    test_links: ['tools/autonomy/governance.test.mjs'],
  };
  assert.equal(validateContract(body(intent), docs, model).type, 'docs');
  assert.throws(() => validateContract(body(intent), impact, model), /runtime evidence/);
});
test('changed UI cannot declare its way out of visual classification', () => {
  assert.equal(impact.ui, true);
  assert.equal(classifyImpact(['src/app/App.tsx'], policy, model).ui, true);
});
test('protected governance, execution hooks and renamed protected files cannot self-authorize', () => {
  for (const filename of [
    '.github/workflows/pr-quality.yml',
    'tools/assurance/model.mjs',
    'AGENTS.md',
    'package.json',
    'pnpm-lock.yaml',
    'scripts/run-e2e.mjs',
  ])
    assert.equal(classifyImpact([{ filename }], policy, model).risk, 'protected');
  assert.equal(
    classifyImpact(
      [{ filename: 'docs/model.md', previous_filename: 'tools/assurance/model.mjs' }],
      policy,
      model,
    ).risk,
    'protected',
  );
  const fixture = decisionFixture();
  fixture.context.impact = { ...impact, risk: 'protected' };
  fixture.decision.contextHash = digest(fixture.context);
  assert.throws(() => validateReview(fixture.decision, fixture.context), /external approval/);
});
test('fake visibility E2E and fixtures returning unconditional success are rejected', () => {
  for (const field of [
    'sourceInputsVerified',
    'dataSafetyReviewed',
    'uiCaptureVerified',
    'authoritativeOutcomes',
    'fixturesDoNotShortcut',
    'productionEntrypoints',
  ]) {
    const fixture = decisionFixture();
    fixture.decision.adequacy[field] = false;
    assert.throws(() => validateReview(fixture.decision, fixture.context), /adequacy/);
  }
  const fixture = decisionFixture();
  fixture.decision.probes[0].regression = 'passed';
  assert.throws(() => validateReview(fixture.decision, fixture.context), /regression-detecting/);
});
test('review records reject changed head or evidence and do not authenticate a reviewer', () => {
  const fixture = decisionFixture();
  fixture.context.headSha = base;
  assert.throws(() => validateReview(fixture.decision, fixture.context), /headSha mismatch/);
});
function evidenceFixture() {
  const directory = 'reports/assurance/1234-abcd';
  const receipt = {
    id: '1234-abcd',
    modelHash: hash,
    sourceHash: hash,
    finishedAt: new Date().toISOString(),
    layers: { web: { exitCode: 0 }, extension: { exitCode: 0 } },
  };
  const audit = {
    runId: receipt.id,
    modelHash: hash,
    sourceHash: hash,
    finished: true,
    stale: false,
    layerFailures: [],
    measurementFailures: [],
    cases: [{ key: 'delivery/reconnect', priority: 'P0', status: 'verified' }],
    performance: [],
  };
  const files = new Map([
    [`${directory}/run.json`, Buffer.from(JSON.stringify(receipt))],
    [`${directory}/audit.json`, Buffer.from(JSON.stringify(audit))],
  ]);
  const manifest = {
    schemaVersion: 1,
    repo: policy.repository,
    pr: 4,
    headSha: sha,
    workflowRunId: '42',
    runAttempt: 1,
    event: 'pull_request',
    treeSha: base,
    policyVersion: policy.version,
    modelHash: hash,
    sourceHash: hash,
    status: 'passed',
    assuranceDirectory: directory,
    files: Array.from(files, ([path, content]) => ({
      path,
      size: content.length,
      sha256: digest(content),
    })),
  };
  const metadata = {
    repo: policy.repository,
    pr: 4,
    headSha: sha,
    policy,
    run: {
      id: 42,
      run_attempt: 1,
      event: 'pull_request',
      head_sha: sha,
      repository: { full_name: policy.repository },
      path: policy.ciWorkflow,
      status: 'completed',
      conclusion: 'success',
      updated_at: new Date().toISOString(),
    },
    job: { name: policy.ciJob, conclusion: 'success' },
    artifact: { expired: false, workflow_run: { id: 42 } },
    commit: { tree: { sha: base } },
  };
  return { manifest, metadata, files, read: (path) => files.get(path) };
}
test('exact GitHub run, commit tree, trusted workflow and actual hashed artifacts required', () => {
  const fixture = evidenceFixture();
  assert.equal(verifyEvidence(fixture.manifest, fixture.metadata, fixture.read).audit.stale, false);
  fixture.manifest.headSha = base;
  assert.throws(() => verifyEvidence(fixture.manifest, fixture.metadata, fixture.read), /Stale/);
});
test('failed original runs, stale policy and tampered reports cannot become passing evidence', () => {
  for (const mutate of [
    (f) => {
      f.metadata.run.conclusion = 'failure';
    },
    (f) => {
      f.manifest.policyVersion = hash;
    },
    (f) => {
      f.files.set(`${f.manifest.assuranceDirectory}/audit.json`, Buffer.from('{}'));
    },
    (f) => {
      f.metadata.run.path = '.github/workflows/attacker.yml';
    },
  ]) {
    const fixture = evidenceFixture();
    mutate(fixture);
    assert.throws(() => verifyEvidence(fixture.manifest, fixture.metadata, fixture.read));
  }
});
test('artifact traversal is rejected', () => {
  for (const path of [
    '../secret',
    '/tmp/file',
    'reports/../../file',
    'reports\\file',
    'reports/\u0000file',
  ])
    assert.throws(() => safePath(path));
});
function performanceFixture() {
  const fixture = decisionFixture();
  const environment = {
    measurement: 'trusted-event-to-visible-raf-v2',
    browser: '151.0',
    platform: 'linux',
    architecture: 'x64',
    viewport: { width: 360, height: 780 },
    reducedMotion: true,
    surface: 'web',
    fixture: 'controlled-http-streams',
    workload: 'retained draft',
  };
  const key = JSON.stringify(['appearance-applied', environment]);
  const previous = {
    key,
    id: 'appearance-applied',
    environment: structuredClone(environment),
    values: [10, 11, 12, 13, 14],
    medianMs: 12,
    p95Ms: 14,
  };
  const group = {
    key,
    id: previous.id,
    environment,
    values: [11, 12, 13, 14, 15],
    medianMs: 13,
    p95Ms: 15,
    comparison: { status: 'within baseline', deltaMs: 1, toleranceMs: 50 },
  };
  fixture.context.change = {
    ...change,
    type: 'perf',
    performance: {
      interaction: group.id,
      sample_size: 5,
      baseline: 'tools/assurance/baseline.json',
      environment: 'Chromium Linux x64 mobile reduced motion controlled HTTP',
    },
  };
  fixture.context.assuranceModel = { interactions: [{ id: group.id }] };
  fixture.context.audit = { modelHash: hash, performance: [group] };
  const document = {
    version: 1,
    provenance: {
      modelHash: hash,
      sourceHash: hash,
      runId: 'baseline-run',
      createdAt: '2026-01-01T00:00:00Z',
    },
    groups: [previous],
  };
  fixture.context.performanceBaseline = {
    path: 'tools/assurance/baseline.json',
    documentHash: digest(document),
    document,
  };
  fixture.decision.adequacy.performanceReviewed = true;
  fixture.decision.contextHash = digest(fixture.context);
  return fixture;
}
test('perf ACCEPT requires review and actual comparable observed baseline evidence', () => {
  const fixture = performanceFixture();
  assert.equal(validateContract(body(fixture.context.change), impact, model).type, 'perf');
  assert.equal(validateReview(fixture.decision, fixture.context).decision, 'ACCEPT');
  for (const mutate of [
    (f) => {
      f.decision.adequacy.performanceReviewed = false;
    },
    (f) => {
      delete f.decision.adequacy.performanceReviewed;
    },
    (f) => {
      f.context.audit.performance = [];
    },
    (f) => {
      f.context.change.performance.interaction = 'unknown';
    },
    (f) => {
      f.context.audit.performance[0].values.pop();
    },
    (f) => {
      f.context.audit.performance[0].values[0] = Infinity;
    },
    (f) => {
      delete f.context.audit.performance[0].environment.browser;
    },
    (f) => {
      f.context.audit.performance[0].comparison.status = 'no comparable baseline';
    },
    (f) => {
      f.context.audit.performance[0].comparison.status = 'insufficient samples';
    },
    (f) => {
      f.context.audit.performance[0].comparison.status = 'regression';
    },
    (f) => {
      f.context.audit.performance[0].values = [100, 100, 100, 100, 100];
      f.context.audit.performance[0].p95Ms = 100;
      f.context.audit.performance[0].medianMs = 100;
    },
    (f) => {
      f.context.performanceBaseline.document.groups[0].values.pop();
    },
    (f) => {
      f.context.performanceBaseline.document.groups[0].environment.platform = 'darwin';
    },
    (f) => {
      delete f.context.performanceBaseline.document.provenance.sourceHash;
    },
    (f) => {
      f.context.performanceBaseline.document.provenance.modelHash = 'd'.repeat(64);
    },
    (f) => {
      f.context.performanceBaseline.document.groups = [];
    },
    (f) => {
      f.context.change.performance.baseline = 'unreviewed baseline';
    },
  ]) {
    const f = performanceFixture();
    mutate(f);
    f.context.performanceBaseline.documentHash = digest(f.context.performanceBaseline.document);
    f.decision.contextHash = digest(f.context);
    assert.throws(() => validateReview(f.decision, f.context));
  }
});
test('perf contract rejects infinite, fractional, string and insufficient sample declarations', () => {
  const intent = performanceFixture().context.change;
  for (const count of [4, 5.5, '5', null])
    assert.throws(
      () =>
        validateContract(
          body({ ...intent, performance: { ...intent.performance, sample_size: count } }),
          impact,
          model,
        ),
      /representative samples/,
    );
  const overflowingJson = body(intent).replace('"sample_size":5', '"sample_size":1e309');
  assert.throws(() => validateContract(overflowingJson, impact, model), /representative samples/);
});

test('review expiry cannot exceed authenticated evidence freshness', () => {
  const now = Date.parse('2026-06-01T12:00:00Z');
  const deadline = now + 60000;
  const fixture = decisionFixture();
  fixture.context.evidenceExpiresAt = new Date(deadline).toISOString();
  fixture.decision.issuedAt = new Date(now - 1000).toISOString();
  fixture.decision.expiresAt = new Date(deadline).toISOString();
  fixture.decision.contextHash = digest(fixture.context);
  assert.equal(
    validateReview(fixture.decision, fixture.context, now).expiresAt,
    fixture.context.evidenceExpiresAt,
  );
  fixture.decision.expiresAt = new Date(deadline + 1).toISOString();
  assert.throws(() => validateReview(fixture.decision, fixture.context, now), /freshness deadline/);
});

test('connected merge checklist binds fresh review, exact head/base, protected CI and policy', async () => {
  const { mergeGate } = await import('./merge-gate.mjs');
  const { context, decision: review } = decisionFixture();
  context.body = 'Reviewed description';
  review.contextHash = digest(context);
  const input = {
    context,
    review,
    policy,
    pr: {
      state: 'open',
      draft: false,
      body: context.body,
      head: { sha },
      base: { sha: base, ref: 'main', repo: { full_name: policy.repository } },
      mergeable: true,
      mergeable_state: 'clean',
    },
    checks: [
      {
        id: 1,
        name: policy.ciJob,
        head_sha: sha,
        app: { id: policy.ciAppId },
        status: 'completed',
        conclusion: 'success',
      },
    ],
    protection: {
      required_status_checks: {
        strict: true,
        checks: [{ context: policy.ciJob, app_id: policy.ciAppId }],
      },
      enforce_admins: { enabled: true },
      required_linear_history: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
    },
    rulesets: [],
  };
  assert.deepEqual(mergeGate(input), { eligible: true, findings: [] });
  for (const mutate of [
    (x) => {
      x.pr.head.sha = base;
    },
    (x) => {
      x.pr.base.sha = sha;
    },
    (x) => {
      x.pr.body = 'Changed';
    },
    (x) => {
      x.pr.mergeable = null;
    },
    (x) => {
      x.review.expiresAt = new Date(0).toISOString();
    },
    (x) => {
      x.review.adequacy.authoritativeOutcomes = false;
    },
    (x) => {
      x.policy.version = 'different';
    },
    (x) => {
      x.protection = null;
    },
    (x) => {
      x.checks[0].app.id = 1;
    },
    (x) => {
      x.checks[0].head_sha = base;
    },
    (x) => {
      x.checks[0].conclusion = 'failure';
    },
    (x) => {
      x.checks.push({ ...x.checks[0], id: 2, status: 'in_progress', conclusion: null });
    },
    (x) => {
      x.context.impact.risk = 'protected';
    },
  ]) {
    const x = structuredClone(input);
    mutate(x);
    assert.equal(mergeGate(x).eligible, false);
  }
});
