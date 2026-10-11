import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { requestDecision, validateDecision } from './acceptance.mjs';
import { canonical, digest, parsePolicy, safePath } from './common.mjs';
import { validateContract } from './contract.mjs';
import { verifyEvidence } from './evidence.mjs';
import { classifyImpact } from './impact.mjs';
import { mergeGate, publishAcceptance } from './merge-gate.mjs';

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
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
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
    envelope: () => ({
      decision,
      signature: sign(null, Buffer.from(canonical(decision)), privateKey).toString('base64'),
    }),
  };
}
test('honest fix requires model cases and signed independent regression-detecting evidence', () => {
  assert.deepEqual(validateContract(body(change), impact, model), change);
  const fixture = decisionFixture();
  assert.equal(validateDecision(fixture.envelope(), fixture.context, publicKey).decision, 'ACCEPT');
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
  assert.throws(
    () => validateDecision(fixture.envelope(), fixture.context, publicKey),
    /external approval/,
  );
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
    assert.throws(
      () => validateDecision(fixture.envelope(), fixture.context, publicKey),
      /adequacy/,
    );
  }
  const fixture = decisionFixture();
  fixture.decision.probes[0].regression = 'passed';
  assert.throws(
    () => validateDecision(fixture.envelope(), fixture.context, publicKey),
    /regression-detecting/,
  );
});
test('unsigned or replayed ACCEPT and new pushes invalidate authority', () => {
  const fixture = decisionFixture();
  assert.throws(
    () =>
      validateDecision(
        { decision: fixture.decision, signature: 'invalid' },
        fixture.context,
        publicKey,
      ),
    /signature/,
  );
  const envelope = fixture.envelope();
  fixture.context.headSha = base;
  assert.throws(() => validateDecision(envelope, fixture.context, publicKey), /headSha mismatch/);
});
test('Dots outage uses bounded retries and never invents an ACCEPT', async () => {
  let attempts = 0;
  await assert.rejects(
    requestDecision(
      {},
      {
        endpoint: 'https://dots.example.test/accept',
        token: 'fixture',
        publicKey,
        policy: { maxRetries: 2, retryDelaySeconds: 0 },
        fetchImpl: async () => {
          attempts++;
          return { ok: false, status: 503 };
        },
      },
    ),
    /unavailable/,
  );
  assert.equal(attempts, 3);
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
function gateFixture() {
  const { context, decision } = decisionFixture();
  const pinnedPolicy = { ...policy, acceptanceAppId: 91, mergeStrategy: 'merge-queue' };
  return {
    pr: {
      state: 'open',
      draft: false,
      head: { sha },
      base: { ref: 'main', sha: base, repo: { full_name: policy.repository } },
      mergeable: true,
      mergeable_state: 'clean',
    },
    context,
    decision,
    policy: pinnedPolicy,
    appId: 91,
    checks: policy.requiredChecks.map((name, id) => ({
      id,
      name,
      head_sha: sha,
      app: { id: name === 'Autonomy / acceptance' ? 91 : policy.ciAppId },
      status: 'completed',
      conclusion: 'success',
    })),
    protection: {
      required_status_checks: {
        strict: true,
        checks: policy.requiredChecks.map((name) => ({
          context: name,
          app_id: name === 'Autonomy / acceptance' ? 91 : policy.ciAppId,
        })),
      },
      enforce_admins: { enabled: true },
      required_linear_history: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
    },
    rulesets: [
      {
        enforcement: 'active',
        rules: [
          { type: 'merge_queue', parameters: { max_entries_to_build: 1, max_entries_to_merge: 1 } },
        ],
      },
    ],
  };
}
test('personal protected auto-merge accepts current PR checks without a queue', () => {
  const fixture = gateFixture();
  fixture.policy.mergeStrategy = 'protected-auto-merge';
  fixture.rulesets = [];
  assert.deepEqual(mergeGate(fixture), { eligible: true, findings: [] });
  for (const [code, mutate] of [
    [
      'CHECK_NOT_SUCCESS:',
      (f) => {
        f.checks = [];
      },
    ],
    [
      'UNPROTECTED_CHECK:',
      (f) => {
        f.protection.required_status_checks.checks = [];
      },
    ],
    [
      'BRANCH_PROTECTION_REQUIRED',
      (f) => {
        f.protection.required_status_checks.strict = false;
      },
    ],
    [
      'HEAD_OR_BASE_CHANGED',
      (f) => {
        f.pr.base.sha = sha;
      },
    ],
    [
      'MERGEABILITY_UNVERIFIED',
      (f) => {
        f.pr.mergeable_state = 'behind';
        f.proposedAcceptance = true;
      },
    ],
    [
      'UNEXPECTED_MERGE_QUEUE',
      (f) => {
        f.rulesets = gateFixture().rulesets;
      },
    ],
    [
      'INTEGRATION_HEAD_NOT_ALLOWED',
      (f) => {
        f.context.headSha = base;
        f.decision.headSha = base;
        for (const check of f.checks) check.head_sha = base;
      },
    ],
    [
      'UNKNOWN_MERGE_STRATEGY',
      (f) => {
        delete f.policy.mergeStrategy;
      },
    ],
    [
      'UNKNOWN_MERGE_STRATEGY',
      (f) => {
        f.policy.mergeStrategy = 'auto';
      },
    ],
    [
      'MERGE_RULES_UNVERIFIED',
      (f) => {
        delete f.rulesets;
      },
    ],
  ]) {
    const changed = structuredClone(fixture);
    mutate(changed);
    const result = mergeGate(changed);
    assert.equal(result.eligible, false, code);
    assert.ok(
      result.findings.some((finding) => finding.startsWith(code)),
      code,
    );
  }
});

test('queue strategy requires a queue and accepts integration checks only at the exact SHA', () => {
  const fixture = gateFixture();
  fixture.rulesets = [];
  assert.ok(mergeGate(fixture).findings.includes('MERGE_QUEUE_REQUIRED'));
  fixture.rulesets = gateFixture().rulesets;
  fixture.context.headSha = 'd'.repeat(40);
  fixture.decision.headSha = fixture.context.headSha;
  fixture.pr.mergeable_state = 'behind';
  for (const check of fixture.checks) check.head_sha = fixture.context.headSha;
  assert.equal(mergeGate(fixture).eligible, true);
});

test('normal accepted fix can request protected merge; queue synthetic SHA must have its own checks', () => {
  const fixture = gateFixture();
  assert.equal(mergeGate(fixture).eligible, true);
  fixture.context.headSha = 'd'.repeat(40);
  fixture.decision.headSha = fixture.context.headSha;
  assert.equal(mergeGate(fixture).eligible, false);
});
test('missing protection, wrong App, changed head/base or policy blocks unattended merge', () => {
  for (const mutate of [
    (f) => {
      f.protection = null;
    },
    (f) => {
      f.appId = 1;
    },
    (f) => {
      f.pr.head.sha = base;
    },
    (f) => {
      f.pr.base.sha = sha;
    },
    (f) => {
      f.decision.policyVersion = hash;
    },
    (f) => {
      f.context.impact = {
        ...impact,
        risk: 'protected',
        protectedFiles: ['tools/assurance/model.mjs'],
      };
    },
  ]) {
    const fixture = gateFixture();
    mutate(fixture);
    assert.equal(mergeGate(fixture).eligible, false);
  }
});

test('queue batches and missing queue limits fail closed', () => {
  for (const parameters of [
    undefined,
    {},
    { max_entries_to_build: 2, max_entries_to_merge: 1 },
    { max_entries_to_build: 1, max_entries_to_merge: 2 },
  ]) {
    const fixture = gateFixture();
    fixture.rulesets[0].rules[0].parameters = parameters;
    assert.equal(mergeGate(fixture).eligible, false);
  }
});
test('expired acceptance, edited intent and unknown mergeability fail closed', () => {
  for (const mutate of [
    (f) => {
      f.decision.expiresAt = new Date(0).toISOString();
    },
    (f) => {
      f.pr.body = 'edited';
    },
    (f) => {
      f.pr.mergeable = null;
    },
  ]) {
    const fixture = gateFixture();
    mutate(fixture);
    assert.equal(mergeGate(fixture).eligible, false);
  }
});

test('publication never writes success on blocked protection, stale final body or replaced queue', async () => {
  for (const scenario of ['protection', 'body', 'queue', 'success', 'self-blocked']) {
    const f = gateFixture();
    const check = {
      id: 10,
      name: 'Autonomy / acceptance',
      app: { id: 91 },
      head_sha: sha,
      status: 'in_progress',
    };
    const writes = [];
    let reads = 0;
    const github = {
      async api(path, options) {
        if (options) {
          writes.push(options.body);
          return {};
        }
        if (path.startsWith('/git/ref'))
          return { object: { sha: scenario === 'queue' ? base : sha } };
        reads++;
        return { ...f.pr, ...(scenario === 'body' && reads === 2 ? { body: 'edited' } : {}) };
      },
    };
    if (scenario === 'protection') f.protection = null;
    if (scenario === 'self-blocked') f.pr.mergeable_state = 'blocked';
    const execute = () =>
      publishAcceptance({
        ...f,
        github,
        number: 4,
        check,
        run: {
          id: 42,
          run_attempt: 1,
          event: 'merge_group',
          head_branch: 'gh-readonly-queue/main/pr-4',
        },
        summary: 'verified',
      });
    if (scenario === 'success' || scenario === 'self-blocked') {
      await execute();
      assert.equal(writes.length, 1);
      assert.equal(writes[0].conclusion, 'success');
      assert.equal(JSON.parse(writes[0].output.text).pr, 4);
    } else {
      await assert.rejects(execute);
      assert.equal(writes.length, 0, scenario);
    }
  }
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
test('perf ACCEPT requires signed review and actual comparable observed baseline evidence', () => {
  const fixture = performanceFixture();
  assert.equal(validateContract(body(fixture.context.change), impact, model).type, 'perf');
  assert.equal(validateDecision(fixture.envelope(), fixture.context, publicKey).decision, 'ACCEPT');
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
    assert.throws(() => validateDecision(f.envelope(), f.context, publicKey));
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

test('signed decision expiry cannot extend near-expired source evidence and revocation inherits its deadline', async () => {
  const { acceptanceMetadata, revocationReason } = await import('./invalidate.mjs');
  const now = Date.parse('2026-06-01T12:00:00Z');
  const deadline = now + 60000;
  const fixture = decisionFixture();
  fixture.context.evidenceExpiresAt = new Date(deadline).toISOString();
  fixture.decision.issuedAt = new Date(now - 1000).toISOString();
  fixture.decision.expiresAt = new Date(deadline).toISOString();
  fixture.decision.contextHash = digest(fixture.context);
  const validated = validateDecision(fixture.envelope(), fixture.context, publicKey, now);
  assert.equal(validated.expiresAt, fixture.context.evidenceExpiresAt);
  const metadata = acceptanceMetadata(fixture.context, validated, {
    id: 42,
    run_attempt: 1,
    event: 'pull_request',
  });
  assert.equal(metadata.expiresAt, fixture.context.evidenceExpiresAt);
  const configuredPolicy = { ...policy, acceptanceAppId: 91 };
  const check = {
    name: 'Autonomy / acceptance',
    app: { id: 91 },
    conclusion: 'success',
    head_sha: fixture.context.headSha,
  };
  const pr = {
    number: fixture.context.pr,
    state: 'open',
    draft: false,
    head: { sha: fixture.context.prHeadSha },
    base: {
      ref: policy.baseBranch,
      sha: fixture.context.baseSha,
      repo: { full_name: policy.repository },
    },
    body: '',
  };
  assert.equal(revocationReason(check, metadata, pr, configuredPolicy, now), null);
  assert.equal(
    revocationReason(check, metadata, pr, configuredPolicy, deadline),
    'Acceptance expired',
  );
  for (const expires of [deadline + 1, now + 3600000, now + 23 * 3600000]) {
    fixture.decision.expiresAt = new Date(expires).toISOString();
    assert.throws(
      () => validateDecision(fixture.envelope(), fixture.context, publicKey, now),
      /evidence freshness deadline/,
    );
  }
  fixture.decision.expiresAt = new Date(deadline).toISOString();
  for (const expiresAt of [undefined, 'invalid', new Date(now).toISOString()]) {
    fixture.context.evidenceExpiresAt = expiresAt;
    fixture.decision.contextHash = digest(fixture.context);
    assert.throws(
      () => validateDecision(fixture.envelope(), fixture.context, publicKey, now),
      /evidence freshness deadline/,
    );
  }
});
