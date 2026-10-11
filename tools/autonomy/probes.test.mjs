// Node tooling tests run without the application browser/Vitest environment.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assess, mutate } from './probes.mjs';

const expected = {
  id: 'run',
  modelHash: 'model',
  sourceHash: 'source',
  obligations: ['expiry-revokes-composer', 'late-response-rejected', 'fresh-login-required'],
};
function fixture(mutant = false) {
  const names = [
    'an isolated product with real HTTP and Streams protocol boundaries',
    'my authorization expires while a conversation is streaming',
    'the product obligations for this segment hold',
    'its late reply arrives and I authorize this device again',
    'the product obligations for this segment hold',
  ];
  const steps = names.map((name, index) => ({
    name,
    keyword: 'Then ',
    result: {
      status: mutant && index === 2 ? 'failed' : mutant && index > 2 ? 'skipped' : 'passed',
      error_message: 'expect(locator).toHaveCount(0) failed',
    },
  }));
  return {
    report: [
      {
        elements: [{ type: 'scenario', name: 'change-identity-during-work / token-expiry', steps }],
      },
    ],
    evidence: {
      journey: 'change-identity-during-work',
      case: 'token-expiry',
      layer: 'web',
      runId: expected.id,
      modelHash: expected.modelHash,
      sourceHash: expected.sourceHash,
      status: mutant ? 'failed' : 'passed',
      checkpoints: mutant ? [] : expected.obligations.map((id) => ({ id })),
    },
  };
}
test('mutation is anchored in the real product controller and fails closed on drift', async () => {
  const source = await readFile(
    new URL('../../src/features/account/controller.ts', import.meta.url),
    'utf8',
  );
  assert.match(mutate(source), /return; \/\/ autonomy controlled regression/);
  assert.throws(() => mutate('changed source'));
  assert.throws(() => mutate(source + source));
});
test('complete passing obligations and targeted expiry failure are accepted', () => {
  for (const mutant of [false, true]) {
    const { report, evidence } = fixture(mutant);
    assess(report, evidence, expected, mutant);
  }
});
test('zero scenarios, skipped execution, stale evidence and missing obligations fail closed', () => {
  const modifications = [
    (f) => {
      f.report = [];
    },
    (f) => {
      f.report[0].elements.push(f.report[0].elements[0]);
    },
    (f) => {
      f.report[0].elements[0].steps[0].result.status = 'skipped';
    },
    (f) => {
      f.evidence.runId = 'stale';
    },
    (f) => {
      f.evidence.sourceHash = 'stale';
    },
    (f) => {
      f.evidence.checkpoints.pop();
    },
    (f) => {
      f.evidence.checkpoints.push(f.evidence.checkpoints[0]);
    },
  ];
  for (const modify of modifications) {
    const f = fixture();
    modify(f);
    assert.throws(() => assess(f.report, f.evidence, expected));
  }
});
test('setup and unrelated failures never count as a killed mutation', () => {
  for (const kind of ['setup', 'unrelated', 'checkpoint']) {
    const f = fixture(true);
    if (kind === 'setup') f.report[0].elements[0].steps[0].result.status = 'failed';
    if (kind === 'unrelated')
      f.report[0].elements[0].steps[2].result.error_message = 'ECONNREFUSED';
    if (kind === 'checkpoint') f.evidence.checkpoints.push({ id: 'expiry-revokes-composer' });
    assert.throws(() => assess(f.report, f.evidence, expected, true));
  }
});

test('UI evidence binds trusted revisions, fixtures, inline HTTPS URLs and published bytes', async () => {
  const { verifyProbeUiEvidence } = await import('./probes.mjs');
  const { contentHash } = await import('./screenshot-manifest.mjs');
  const bytes = Buffer.from('published screenshot bytes');
  const hash = contentHash(bytes);
  const expected = {
    beforeSha: 'a'.repeat(40),
    candidateSha: 'b'.repeat(40),
    fixtureHash: contentHash('shared fixtures'),
    allowedOrigins: ['https://images.example.test'],
  };
  const manifest = {
    schemaVersion: 1,
    fixtureHash: expected.fixtureHash,
    captures: ['before', 'candidate'].map((role) => ({
      role,
      sha: role === 'before' ? expected.beforeSha : expected.candidateSha,
      route: '/#/account',
      viewport: { width: 360, height: 780 },
      theme: 'light',
      scenario: 'signed-in',
      path: `${role}.png`,
      contentHash: hash,
      url: `https://images.example.test/${hash}/${role}.png`,
    })),
  };
  const body = manifest.captures.map((capture) => `![${capture.role}](${capture.url})`).join('\n');
  const receipt = await verifyProbeUiEvidence(manifest, body, expected, async () => bytes);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.captures.length, 2);
  await assert.rejects(
    verifyProbeUiEvidence(manifest, body, expected, async () => Buffer.from('different bytes')),
    /hash mismatch/,
  );
  await assert.rejects(verifyProbeUiEvidence(manifest, body, expected), /byte reader required/);
  await assert.rejects(
    verifyProbeUiEvidence(manifest, '', expected, async () => bytes),
    /inline PR body/,
  );
  await assert.rejects(
    verifyProbeUiEvidence(
      manifest,
      body,
      { ...expected, candidateSha: 'c'.repeat(40) },
      async () => bytes,
    ),
    /SHA mismatch/,
  );
  await assert.rejects(
    verifyProbeUiEvidence(
      manifest,
      body,
      { ...expected, fixtureHash: 'd'.repeat(64) },
      async () => bytes,
    ),
    /fixtures mismatch/,
  );
  await assert.rejects(
    verifyProbeUiEvidence(manifest, body, {}, async () => bytes),
    /before SHA required/,
  );
  const unpublished = structuredClone(manifest);
  delete unpublished.captures[0].url;
  await assert.rejects(
    verifyProbeUiEvidence(unpublished, body, expected, async () => bytes),
    /Published screenshot URL/,
  );
});

test('strict UI contract accepts trusted UUID upload receipts and rejects missing or forged evidence', async () => {
  const { verifyProbeUiEvidence } = await import('./probes.mjs');
  const { contentHash } = await import('./screenshot-manifest.mjs');
  const bytes = Buffer.from('captured bytes verified by publisher');
  const fixtureHash = contentHash('candidate fixtures');
  const manifest = {
    schemaVersion: 1,
    fixtureHash,
    captures: ['before', 'candidate'].map((role) => ({
      role,
      sha: (role === 'before' ? 'a' : 'b').repeat(40),
      route: '/#/account',
      viewport: { width: 1280, height: 800 },
      theme: 'light',
      scenario: 'signed-in-account',
      path: `${role}.png`,
      contentHash: contentHash(bytes),
      url: `https://github.com/user-attachments/assets/${role}-uuid`,
    })),
  };
  const body = manifest.captures.map((capture) => `![${capture.role}](${capture.url})`).join('\n');
  const expected = {
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    fixtureHash,
    impact: { ui: true },
    policy: {
      screenshot: {
        allowedImageHosts: ['github.com'],
        themes: ['light'],
        viewports: [{ width: 1280, height: 800 }],
      },
    },
    readArtifact: () => bytes,
    publishedAssets: manifest.captures.map(({ path, url, contentHash }) => ({
      path,
      url,
      contentHash,
    })),
  };
  const receipt = await verifyProbeUiEvidence(manifest, body, expected);
  assert.equal(receipt.publicationVerification, 'trusted-upload-receipts');
  for (const override of [
    { publishedAssets: [] },
    { readArtifact: () => Buffer.from('tampered') },
    { readArtifact: async () => bytes },
    { impact: {} },
    { headSha: 'c'.repeat(40) },
    { policy: { screenshot: { ...expected.policy.screenshot, themes: ['light', 'dark'] } } },
  ])
    await assert.rejects(verifyProbeUiEvidence(manifest, body, { ...expected, ...override }));
  await assert.rejects(verifyProbeUiEvidence(manifest, '', expected));
  await assert.rejects(
    verifyProbeUiEvidence(manifest, body, expected, async () =>
      Buffer.from('changed remote bytes'),
    ),
  );
});

test('intent parsing bounds untrusted bodies and rejects duplicate or dangling delimiters', async () => {
  const { parseIntent } = await import('./contract.mjs');
  const start = '<!-- autonomous-intent:start -->';
  const end = '<!-- autonomous-intent:end -->';
  const valid = `${start}\n\`\`\`json\n{"change":{"type":"docs"}}\n\`\`\`\n${end}`;
  assert.deepEqual(parseIntent(`Author text\n${valid}\nOther text`), { type: 'docs' });
  for (const input of [
    null,
    '',
    valid + valid,
    valid + start,
    end + valid,
    start + end,
    `${end}${start}`,
    `${start}\`\`\`json${' '.repeat(32000)}`,
    `${valid}${' '.repeat(60000)}`,
    valid.replace('```json', '```text'),
  ]) {
    assert.throws(() => parseIntent(input));
  }
  const jsonWithBackticks = `${start}\`\`\`json{"change":{"summary":"literal \`\`\` text"}}\`\`\`${end}`;
  assert.equal(parseIntent(jsonWithBackticks).summary, 'literal ``` text');
});

test('trusted model coverage rejects omitted P0 cases, forged priorities and duplicate rows', async () => {
  const { verifyAuditCoverage } = await import('./evidence.mjs');
  const model = {
    journeys: [
      { id: 'identity', priority: 'P0', cases: [{ id: 'expiry' }] },
      { id: 'draft', priority: 'P1', cases: [{ id: 'reload' }] },
    ],
  };
  const cases = [
    { key: 'identity/expiry', priority: 'P0', status: 'verified' },
    { key: 'draft/reload', priority: 'P1', status: 'uncovered' },
  ];
  verifyAuditCoverage({ cases }, model, true);
  for (const rows of [
    [],
    cases.slice(1),
    [cases[0], cases[0]],
    [{ ...cases[0], priority: 'P1' }, cases[1]],
    [{ ...cases[0], status: 'uncovered' }, cases[1]],
  ])
    assert.throws(() => verifyAuditCoverage({ cases: rows }, model, true));
});

test('merge-group evidence uses queue sentinel and trusted model binding', async () => {
  const { verifyEvidence } = await import('./evidence.mjs');
  const { digest } = await import('./common.mjs');
  const sha = 'a'.repeat(40);
  const hash = 'b'.repeat(64);
  const model = { journeys: [{ id: 'identity', priority: 'P0', cases: [{ id: 'expiry' }] }] };
  const modelHash = digest(Buffer.from(JSON.stringify(model)));
  const directory = 'reports/assurance/1234-abcd';
  const receipt = {
    id: '1234-abcd',
    modelHash,
    sourceHash: hash,
    finishedAt: '2026-01-01',
    layers: { web: { exitCode: 0 }, extension: { exitCode: 0 } },
  };
  const audit = {
    runId: receipt.id,
    modelHash,
    sourceHash: hash,
    finished: true,
    stale: false,
    layerFailures: [],
    measurementFailures: [],
    cases: [{ key: 'identity/expiry', priority: 'P0', status: 'verified' }],
    performance: [],
  };
  const files = new Map([
    [`${directory}/run.json`, Buffer.from(JSON.stringify(receipt))],
    [`${directory}/audit.json`, Buffer.from(JSON.stringify(audit))],
  ]);
  const manifest = {
    schemaVersion: 1,
    repo: 'owner/repo',
    pr: 0,
    headSha: sha,
    workflowRunId: '42',
    runAttempt: 2,
    event: 'merge_group',
    treeSha: sha,
    policyVersion: hash,
    modelHash,
    sourceHash: hash,
    status: 'passed',
    assuranceDirectory: directory,
    files: Array.from(files, ([path, bytes]) => ({
      path,
      size: bytes.length,
      sha256: digest(bytes),
    })),
  };
  const expected = {
    run: {
      id: 42,
      run_attempt: 2,
      event: 'merge_group',
      head_sha: sha,
      repository: { full_name: 'owner/repo' },
      path: 'quality.yml',
      status: 'completed',
      conclusion: 'success',
      updated_at: '2026-01-01T00:00:00Z',
    },
    job: { name: 'PR Quality / verify', conclusion: 'success' },
    artifact: { expired: false, workflow_run: { id: 42 } },
    commit: { tree: { sha } },
    policy: {
      ciWorkflow: 'quality.yml',
      ciJob: 'PR Quality / verify',
      version: hash,
      strictP0: true,
      maxEvidenceAgeHours: 24,
    },
    repo: 'owner/repo',
    pr: 7,
    headSha: sha,
    trustedModel: model,
    now: Date.parse('2026-01-01T00:01:00Z'),
  };
  verifyEvidence(manifest, expected, (path) => files.get(path));
  assert.throws(() => verifyEvidence({ ...manifest, pr: 7 }, expected, (path) => files.get(path)));
  assert.throws(
    () =>
      verifyEvidence(manifest, { ...expected, trustedModel: { journeys: [] } }, (path) =>
        files.get(path),
      ),
    /trusted assurance model/,
  );
});

test('UI orchestration preserves required surfaces and authenticated workflow link', async () => {
  const { validateUiEvidence } = await import('./ui-evidence.mjs');
  const { digest } = await import('./common.mjs');
  const { capturePlanHash } = await import('./capture-ui.mjs');
  const changedPaths = ['src/features/account/AccountPage.tsx'];
  const capturePlans = [
    {
      surface: 'web',
      route: '/#/account',
      scenario: 'signed-in-account',
      state: 'Account signed in',
      account: 'signed-in',
      covers: changedPaths,
      actions: [{ action: 'assertVisible', role: 'button', name: '退出此设备' }],
    },
  ];
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const headSha = 'a'.repeat(40);
  const baseSha = 'b'.repeat(40);
  const manifest = {
    schemaVersion: 1,
    fixtureHash: digest('fixtures'),
    plans: capturePlans,
    planHash: capturePlanHash(capturePlans),
    captures: ['before', 'candidate'].map((role) => ({
      role,
      surface: 'web',
      sha: role === 'before' ? baseSha : headSha,
      route: '/#/account',
      scenario: 'signed-in-account',
      state: 'Account signed in',
      viewport: { width: 1280, height: 800 },
      theme: 'light',
      path: `${role}.png`,
      contentHash: digest(bytes),
    })),
  };
  const sourceTrees = { before: 'c'.repeat(40), candidate: 'd'.repeat(40) };
  const buildBytes = new Map();
  manifest.builds = {};
  for (const role of ['before', 'candidate']) {
    const sha = role === 'before' ? baseSha : headSha;
    const path = `${role}-build.json`;
    const receipt = {
      schemaVersion: 1,
      sha,
      treeSha: sourceTrees[role],
      files: [{ path: 'index.html', contentHash: digest('compiled HTML') }],
    };
    const encoded = Buffer.from(JSON.stringify(receipt));
    buildBytes.set(`reports/autonomy/screenshots/${path}`, encoded);
    manifest.builds[role] = { path, sha, treeSha: sourceTrees[role], contentHash: digest(encoded) };
  }
  const trustedCapture = {
    fixtureHash: manifest.fixtureHash,
    controllerSha: baseSha,
    sourceRunId: 42,
    sourceRunAttempt: 2,
    captureRunId: 43,
    captureRunAttempt: 1,
    sourceArtifactId: 10,
    candidateTreeSha: sourceTrees.candidate,
    baseTreeSha: sourceTrees.before,
  };
  manifest.captureContext = { ...trustedCapture };
  const pr = { number: 4, head: { sha: headSha }, base: { sha: baseSha }, body: 'Author content' };
  const updates = [];
  let remoteBody = pr.body;
  let uploads = 0;
  const options = {
    pr,
    headSha,
    baseSha,
    requiredSurfaces: ['web'],
    capturePlans,
    changedPaths,
    requiredPaths: changedPaths,
    runUrl: 'https://github.com/owner/repo/actions/runs/42/attempts/2',
    sourceTrees,
    trustedCapture,
    policy: {
      screenshot: {
        allowedImageHosts: ['github.com'],
        themes: ['light'],
        viewports: [{ width: 1280, height: 800 }],
      },
    },
    env: {
      AUTONOMY_IMAGE_TOKEN: 'github_pat_fixture',
    },
    readArtifact: (path) =>
      path.endsWith('manifest.json')
        ? Buffer.from(JSON.stringify(manifest))
        : (buildBytes.get(path) ?? bytes),
    github: {
      repo: 'owner/repo',
      api: async (path, request) => {
        if (request?.method === 'PATCH') {
          remoteBody = request.body.body;
          updates.push(remoteBody);
          return {};
        }
        return { ...structuredClone(pr), body: remoteBody };
      },
    },
    runCommand: async (command, args) => {
      assert.equal(command, 'gh');
      if (args.includes('--help')) return { stdout: '--attach file' };
      const bodyFile = args[args.indexOf('--body-file') + 1];
      remoteBody = await readFile(bodyFile, 'utf8');
      for (let index = args.indexOf('--attach'); index < args.length; index += 2) {
        const path = args[index + 1];
        uploads++;
        remoteBody = remoteBody.replace(
          `](${path})`,
          `](https://github.com/user-attachments/assets/upload-${uploads})`,
        );
      }
      return { stdout: 'https://github.com/owner/repo/pull/4' };
    },
    fetchImpl: async () => new Response(bytes),
  };
  await assert.rejects(
    validateUiEvidence({ ...options, requiredSurfaces: ['web', 'extension'] }),
    /surface missing|missing required surface/,
  );
  assert.equal(uploads, 0, 'Missing surfaces must fail before publication');
  await assert.rejects(
    validateUiEvidence({ ...options, sourceTrees: { ...sourceTrees, candidate: 'e'.repeat(40) } }),
    /tree mismatch/,
  );
  assert.equal(uploads, 0, 'Wrong build trees must fail before publication');
  const { verifyUiBuildReceipts } = await import('./ui-evidence.mjs');
  const tampered = structuredClone(manifest);
  tampered.builds.candidate.contentHash = 'f'.repeat(64);
  assert.throws(() => verifyUiBuildReceipts(tampered, options), /hash mismatch/);
  assert.throws(
    () => verifyUiBuildReceipts({ ...manifest, builds: undefined }, options),
    /reference missing/,
  );
  const alteredPlans = structuredClone(capturePlans);
  alteredPlans[0].state = 'Different authored state';
  await assert.rejects(
    validateUiEvidence({ ...options, capturePlans: alteredPlans }),
    /Capture plan differs/,
  );
  await assert.rejects(
    validateUiEvidence({ ...options, requiredPaths: [...changedPaths, 'src/omitted.ts'] }),
    /Affected paths omitted/,
  );
  assert.equal(uploads, 0, 'Changed plans and omitted coverage must fail before publication');
  const verified = await validateUiEvidence(options);
  assert.equal(verified.builds.candidate.treeSha, sourceTrees.candidate);
  assert.equal(updates.length, 0);
  assert.equal(uploads, 0);
  assert.equal(remoteBody, pr.body);
  assert.equal(verified.publication, 'pending-assistant-review');
  await assert.rejects(
    validateUiEvidence({
      ...options,
      readArtifact: (path) =>
        path.endsWith('.png') ? Buffer.from('tampered') : options.readArtifact(path),
    }),
    /Screenshot bytes/,
  );
});

test('separate capture authentication binds protected fixtures, workflow, source artifact and attempts', async () => {
  const { authenticateCapture, resolveAcceptanceRuns } = await import('./orchestrate.mjs');
  const { computeTrustedFixtureHash } = await import('./capture-ui.mjs');
  const policy = { repository: 'owner/repo' };
  const baseSha = 'b'.repeat(40);
  const sourceRun = { id: 42, run_attempt: 2, head_sha: 'a'.repeat(40) };
  const captureRun = {
    id: 43,
    run_attempt: 1,
    head_sha: 'c'.repeat(40),
    path: '.github/workflows/pr-evidence.yml',
    name: 'PR UI Evidence',
    event: 'workflow_run',
    status: 'completed',
    conclusion: 'success',
    repository: { full_name: policy.repository },
  };
  const captureArtifact = {
    id: 11,
    name: `autonomy-ui-${sourceRun.head_sha}-42-2-1`,
    workflow_run: { id: 43 },
    expired: false,
    size_in_bytes: 1000,
  };
  const sourceTrees = { before: 'd'.repeat(40), candidate: 'e'.repeat(40) };
  const calls = [];
  const github = {
    api: async (path) => {
      if (path === '/actions/runs/43') return captureRun;
      if (path === '/actions/runs/42') return sourceRun;
      if (path.startsWith('/compare/')) return { status: 'ahead' };
      throw new Error(`Unexpected fixture API ${path}`);
    },
    pages: async (path) =>
      path.endsWith('/artifacts')
        ? [captureArtifact]
        : [{ name: 'capture', conclusion: 'success' }],
    content: async (path, ref) => {
      calls.push({ path, ref });
      return path.endsWith('.yml') ? 'protected workflow' : `protected content:${path}`;
    },
  };
  const options = {
    captureRun,
    captureArtifact,
    sourceRun,
    sourceArtifact: { id: 10 },
    baseSha,
    sourceTrees,
    policy,
    capturePlans: [
      {
        surface: 'web',
        route: '/#/account',
        scenario: 'signed-in-account',
        state: 'Signed in',
        account: 'signed-in',
        covers: ['src/account.ts'],
        actions: [{ action: 'assertVisible', role: 'button', name: '退出此设备' }],
      },
    ],
    changedPaths: ['src/account.ts'],
    requiredPaths: ['src/account.ts'],
    requiredSurfaces: ['web'],
  };
  const authenticated = await authenticateCapture(github, options);
  assert.equal(authenticated.sourceArtifactId, 10);
  const { capturePlanHash } = await import('./capture-ui.mjs');
  assert.equal(authenticated.planHash, capturePlanHash(options.capturePlans));
  await assert.rejects(
    authenticateCapture(github, { ...options, requiredPaths: ['src/omitted.ts'] }),
    /Affected paths omitted/,
  );
  assert.equal(
    authenticated.fixtureHash,
    await computeTrustedFixtureHash(sourceTrees.before, (path) =>
      Promise.resolve(`protected content:${path}`),
    ),
  );
  assert.ok(calls.filter(({ path }) => !path.endsWith('.yml')).every(({ ref }) => ref === baseSha));
  const resolved = await resolveAcceptanceRuns(github, { AUTONOMY_CAPTURE_RUN_ID: '43' }, policy);
  assert.equal(resolved.run.id, 42);
  assert.equal(resolved.captureArtifact.id, 11);
  for (const override of [
    { captureRun: { ...captureRun, conclusion: 'failure' } },
    { captureRun: { ...captureRun, path: 'candidate-workflow.yml' } },
    { captureRun: { ...captureRun, event: 'pull_request' } },
    { captureRun: { ...captureRun, repository: { full_name: 'foreign/repo' } } },
    { captureArtifact: { ...captureArtifact, workflow_run: { id: 42 } } },
    {
      captureArtifact: {
        ...captureArtifact,
        name: captureArtifact.name.replace('-42-2-1', '-42-1-1'),
      },
    },
  ])
    await assert.rejects(authenticateCapture(github, { ...options, ...override }));
  await assert.rejects(
    authenticateCapture({ ...github, content: async (path, ref) => ref }, options),
    /differs from protected base/,
  );
  await assert.rejects(
    authenticateCapture({ ...github, api: async () => ({ status: 'behind' }) }, options),
    /outside protected base/,
  );
  await assert.rejects(
    resolveAcceptanceRuns(
      {
        ...github,
        api: async (path) => (path.endsWith('/42') ? { ...sourceRun, run_attempt: 3 } : captureRun),
      },
      { AUTONOMY_CAPTURE_RUN_ID: '43' },
      policy,
    ),
    /old source attempt/,
  );
});
