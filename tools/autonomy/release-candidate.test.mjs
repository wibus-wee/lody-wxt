import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';

import {
  inspectCandidate,
  publishedPending,
  releaseVersion,
  validateRun,
} from './release-candidate.mjs';
import { assertPackageSource } from './release-plan.mjs';

const before = { name: 'app', version: '0.2.4', scripts: { check: 'test' } };
const after = { ...before, version: '0.2.5' };
test('only a strict increasing version-only package change forms a release candidate', () => {
  assert.equal(releaseVersion(before, after, { '.': '0.2.4' }, { '.': '0.2.5' }), '0.2.5');
  assert.equal(releaseVersion(before, before, { '.': '0.2.4' }, { '.': '0.2.4' }), null);
  for (const changed of [
    { ...after, version: '0.2.3' },
    { ...after, version: '0.2.5-beta' },
    { ...after, scripts: { check: 'true' } },
  ]) {
    assert.throws(() =>
      releaseVersion(before, changed, { '.': '0.2.4' }, { '.': changed.version }),
    );
  }
  assert.throws(() => releaseVersion(before, after, { '.': '0.2.4' }, { '.': '0.2.6' }));
});

test('candidate must come from the exact same-repository successful PR run', () => {
  const repository = 'wibus-wee/lody-wxt';
  const pr = { number: 25, head: { sha: 'a'.repeat(40) } };
  const run = {
    id: 123,
    run_attempt: 2,
    path: '.github/workflows/release-pr.yml',
    event: 'pull_request',
    head_sha: pr.head.sha,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    status: 'completed',
    conclusion: 'success',
    pull_requests: [{ number: 25 }],
  };
  assert.equal(validateRun(run, pr, repository), `release-candidate-${pr.head.sha}-123-2`);
  for (const changed of [
    { conclusion: 'failure' },
    { status: 'in_progress' },
    { head_sha: 'b'.repeat(40) },
    { event: 'workflow_dispatch' },
    { path: '.github/workflows/untrusted.yml' },
    { pull_requests: [] },
    { head_repository: { full_name: 'attacker/fork' } },
    { repository: { full_name: 'attacker/fork' } },
  ]) {
    assert.throws(() => validateRun({ ...run, ...changed }, pr, repository));
  }
});

test('pending reconciliation requires a published stable release at the exact merged commit', () => {
  const pr = {
    merged_at: '2026-10-13',
    merge_commit_sha: 'a'.repeat(40),
    labels: [{ name: 'autorelease: pending' }],
  };
  const release = { tag_name: 'v0.2.5', draft: false, prerelease: false };
  assert.equal(
    publishedPending(pr, [release], () => pr.merge_commit_sha),
    true,
  );
  for (const r of [
    { ...release, draft: true },
    { ...release, prerelease: true },
  ])
    assert.equal(
      publishedPending(pr, [r], () => pr.merge_commit_sha),
      false,
    );
  assert.equal(
    publishedPending(pr, [release], () => 'b'.repeat(40)),
    false,
  );
  assert.equal(
    publishedPending({ ...pr, merged_at: null }, [release], () => pr.merge_commit_sha),
    false,
  );
  assert.throws(() =>
    publishedPending(pr, [release], () => {
      throw new Error('unavailable');
    }),
  );
});

test('real Git candidate inspection rejects bundled runtime changes', () => {
  const previous = process.cwd();
  const root = mkdtempSync(path.join(tmpdir(), 'release-candidate-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    git('init');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(path.join(root, 'package.json'), JSON.stringify(before));
    writeFileSync(
      path.join(root, '.release-please-manifest.json'),
      JSON.stringify({ '.': '0.2.4' }),
    );
    git('add', '.');
    git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(path.join(root, 'package.json'), JSON.stringify(after));
    writeFileSync(
      path.join(root, '.release-please-manifest.json'),
      JSON.stringify({ '.': '0.2.5' }),
    );
    git('add', '.');
    git('commit', '-m', 'release');
    const head = git('rev-parse', 'HEAD');
    process.chdir(root);
    assert.equal(inspectCandidate(base, head).version, '0.2.5');
    assertPackageSource(head, head);
    const squash = git('commit-tree', `${head}^{tree}`, '-p', base, '-m', 'squashed release');
    assertPackageSource(squash, head);
    assert.throws(() => assertPackageSource(base, head), /source tree differs/);
    writeFileSync(path.join(root, 'runtime.js'), 'changed');
    git('add', '.');
    git('commit', '-m', 'runtime');
    assert.throws(() => inspectCandidate(base, git('rev-parse', 'HEAD')), /metadata only/);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test('release tests stay in read-only PR verification; publication never rebuilds', () => {
  const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  const pr = read('.github/workflows/release-pr.yml');
  assert.match(pr, /pull_request:/);
  assert.doesNotMatch(pr, /: write|secrets\.|environment:/);
  for (const command of [
    'pnpm check',
    'pnpm test:sdk',
    'pnpm test:browser',
    'pnpm test:assurance',
    'pnpm assurance:audit --strict',
    'pnpm release:package',
    'pnpm release:verify',
  ])
    assert.ok(pr.includes(command));
  const release = read('.github/workflows/release.yml');
  assert.doesNotMatch(release, /pnpm (check|test:|build|zip|release:package)|ASSURANCE_REPEAT/);
  assert.match(release, /release-candidate.mjs download/);
  assert.match(release, /pnpm release:verify/);
  assert.match(release, /verify-candidate/);
  assert.match(release, /attestations/);
  assert.match(read('.github/workflows/release-monitor.yml'), /release-plan.mjs verify-published/);
});
