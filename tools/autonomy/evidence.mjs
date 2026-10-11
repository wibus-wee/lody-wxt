import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
import process from 'node:process';

import { digest, hashPattern, parsePolicy, safePath, shaPattern } from './common.mjs';
import { assertCleanSnapshot } from './snapshot.mjs';

const assuranceDirectory = /^reports\/assurance\/[a-f0-9-]+$/;

export function protectedEvidencePolicy(ref, directory = '.') {
  assert.ok(shaPattern.test(ref ?? ''), 'Trusted base policy SHA is required');
  const git = (args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
  git(['cat-file', '-e', `${ref}^{commit}`]);
  const path = '.github/autonomous-maintenance-policy.yml';
  // A first bootstrap PR has no protected policy yet. Never load its candidate policy.
  if (!git(['ls-tree', '--name-only', ref, '--', path]).trim()) return null;
  return parsePolicy(git(['show', `${ref}:${path}`]));
}
export async function collectFiles(root = 'reports', excluded = 'reports/autonomy/evidence.json') {
  const files = [];
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const name = `${path}/${entry.name}`;
      assert.ok(!entry.isSymbolicLink(), 'Evidence cannot contain symlinks');
      if (entry.isDirectory()) await visit(name);
      else if (name !== excluded) {
        const info = await lstat(name);
        assert.ok(info.size <= 100_000_000, 'Oversized evidence file');
        files.push({ path: safePath(name), size: info.size, sha256: digest(await readFile(name)) });
      }
    }
  }
  await visit(root);
  assert.ok(files.length <= 10000, 'Too many evidence files');
  return files;
}
export async function createEvidence({
  repo,
  pr,
  headSha,
  workflowRunId,
  runAttempt,
  status,
  event,
  policyVersion,
  output,
}) {
  assert.ok(shaPattern.test(headSha));
  assert.equal(assertCleanSnapshot(), headSha, 'Evidence checkout differs from candidate');
  const identity = {
    schemaVersion: 1,
    repo,
    pr,
    headSha,
    workflowRunId: String(workflowRunId),
    runAttempt: Number(runAttempt),
    event,
    treeSha: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
    policyVersion,
    status,
    createdAt: new Date().toISOString(),
  };
  let latest;
  try {
    latest = JSON.parse(await readFile('reports/assurance/latest.json', 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' || status !== 'failed') throw error;
    return {
      ...identity,
      acceptanceEligible: false,
      reason: 'Earlier checks failed before assurance produced a run report',
      files: await collectFiles('reports', output),
    };
  }
  assert.ok(assuranceDirectory.test(latest.directory));
  const run = JSON.parse(await readFile(`${latest.directory}/run.json`, 'utf8'));
  const audit = JSON.parse(await readFile(`${latest.directory}/audit.json`, 'utf8'));
  return {
    ...identity,
    modelHash: run.modelHash,
    sourceHash: run.sourceHash,
    testCommand: 'pnpm test:assurance',
    environment: { os: process.platform, browser: 'chromium', mode: 'packaged-and-web' },
    journeys: audit.cases.filter((item) => item.status === 'verified').map((item) => item.key),
    assuranceDirectory: latest.directory,
    files: await collectFiles('reports', output),
  };
}
export function verifyEvidence(
  manifest,
  { run, job, artifact, commit, policy, repo, pr, headSha, trustedModel, now = Date.now() },
  readArtifact,
) {
  assert.notEqual(
    manifest.acceptanceEligible,
    false,
    'Diagnostic evidence cannot authorize acceptance',
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.repo, repo);
  assert.equal(manifest.pr, run.event === 'merge_group' ? 0 : pr);
  assert.equal(manifest.headSha, headSha, 'Stale candidate evidence');
  assert.ok(
    shaPattern.test(headSha) &&
      hashPattern.test(manifest.modelHash) &&
      hashPattern.test(manifest.sourceHash),
  );
  assert.equal(manifest.workflowRunId, String(run.id));
  assert.equal(manifest.runAttempt, run.run_attempt);
  assert.equal(manifest.event, run.event);
  assert.equal(run.head_sha, headSha);
  assert.equal(run.repository.full_name, repo);
  assert.ok(['pull_request', 'merge_group'].includes(run.event));
  assert.equal(run.path, policy.ciWorkflow, 'Untrusted evidence workflow');
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');
  assert.equal(job.name, policy.ciJob);
  assert.equal(job.conclusion, 'success');
  assert.equal(artifact.expired, false);
  assert.equal(artifact.workflow_run?.id, run.id);
  assert.equal(manifest.treeSha, commit.tree.sha);
  assert.equal(manifest.policyVersion, policy.version, 'Policy changed since evidence');
  assert.equal(manifest.status, 'passed');
  const age = now - Date.parse(run.updated_at);
  assert.ok(age >= 0 && age <= policy.maxEvidenceAgeHours * 3600000, 'Expired evidence');
  assert.ok(
    Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 10000,
  );
  const paths = new Set();
  for (const file of manifest.files) {
    safePath(file.path);
    assert.ok(!paths.has(file.path), 'Duplicate artifact path');
    paths.add(file.path);
    const content = readArtifact(file.path);
    assert.equal(content.length, file.size, 'Evidence size mismatch');
    assert.equal(digest(content), file.sha256, 'Evidence content mismatch');
  }
  const read = (path) => {
    assert.ok(paths.has(path), `Missing hashed report ${path}`);
    return JSON.parse(readArtifact(path));
  };
  assert.ok(assuranceDirectory.test(manifest.assuranceDirectory));
  const audit = read(`${manifest.assuranceDirectory}/audit.json`);
  const receipt = read(`${manifest.assuranceDirectory}/run.json`);
  assert.equal(audit.sourceHash, manifest.sourceHash);
  assert.equal(receipt.sourceHash, manifest.sourceHash);
  assert.equal(audit.modelHash, manifest.modelHash);
  assert.equal(receipt.modelHash, manifest.modelHash);
  assert.equal(audit.runId, receipt.id);
  assert.ok(audit.finished && !audit.stale && receipt.finishedAt);
  assert.deepEqual(audit.layerFailures, []);
  assert.deepEqual(audit.measurementFailures, []);
  assert.equal(receipt.layers.web?.exitCode, 0);
  assert.equal(receipt.layers.extension?.exitCode, 0);
  if (trustedModel) {
    assert.equal(
      manifest.modelHash,
      digest(Buffer.from(JSON.stringify(trustedModel))),
      'Evidence differs from trusted assurance model',
    );
    verifyAuditCoverage(audit, trustedModel, policy.strictP0);
  }
  assert.ok(audit.cases.length > 0);
  assert.ok(audit.cases.every((item) => !['failed', 'incomplete'].includes(item.status)));
  if (policy.strictP0)
    assert.ok(
      audit.cases
        .filter((item) => item.priority === 'P0')
        .every((item) => item.status === 'verified'),
      'Unverified P0 obligations',
    );
  assert.ok(audit.performance.every((item) => item.comparison.status !== 'regression'));
  return { manifest, audit, receipt, digest: digest(manifest) };
}

export function verifyAuditCoverage(audit, trustedModel, strictP0) {
  const expected = new Map(
    trustedModel.journeys.flatMap((journey) =>
      journey.cases.map((variant) => [`${journey.id}/${variant.id}`, journey.priority]),
    ),
  );
  assert.equal(audit.cases.length, expected.size, 'Incomplete trusted coverage denominator');
  const seen = new Set();
  for (const item of audit.cases) {
    assert.ok(expected.has(item.key) && !seen.has(item.key), 'Unknown or duplicate assurance case');
    seen.add(item.key);
    assert.equal(
      item.priority,
      expected.get(item.key),
      'Assurance priority differs from trusted model',
    );
    if (strictP0 && expected.get(item.key) === 'P0')
      assert.equal(item.status, 'verified', 'Unverified trusted P0 obligation');
  }
}
