import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { readArchive } from './archive.mjs';
import { assets, sha256, assertReleaseSource, validateTag } from './release-plan.mjs';

const workflow = '.github/workflows/release-pr.yml';
const sha = /^[a-f0-9]{40}$/;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const api = (endpoint) =>
  JSON.parse(
    execFileSync('gh', ['api', endpoint], {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
const pages = (endpoint) =>
  JSON.parse(
    execFileSync('gh', ['api', '--paginate', '--slurp', endpoint], {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    }),
  );

export function releaseVersion(before, after, beforeManifest, afterManifest) {
  if (beforeManifest['.'] === afterManifest['.']) return null;
  const version = afterManifest['.'];
  validateTag(`v${version}`);
  validateTag(`v${beforeManifest['.']}`);
  assert.equal(before.version, beforeManifest['.']);
  assert.equal(after.version, version);
  assert.deepEqual({ ...before, version }, after, 'Release PR may only change the package version');
  const old = before.version.split('.').map(Number);
  const next = version.split('.').map(Number);
  const first = next.findIndex((part, index) => part !== old[index]);
  assert.ok(first >= 0 && next[first] > old[first], 'Release version must increase');
  return version;
}

export function inspectCandidate(base, head) {
  assert.match(base, sha);
  assert.match(head, sha);
  const json = (ref, file) => JSON.parse(git('show', `${ref}:${file}`));
  const version = releaseVersion(
    json(base, 'package.json'),
    json(head, 'package.json'),
    json(base, '.release-please-manifest.json'),
    json(head, '.release-please-manifest.json'),
  );
  if (!version) return null;
  const files = git('diff', '--name-only', base, head).split('\n');
  assert.ok(
    files.every((file) =>
      ['package.json', '.release-please-manifest.json', 'CHANGELOG.md'].includes(file),
    ),
    'Release PR must contain version metadata only; merge product/tooling changes first',
  );
  return { version, head, tree: git('rev-parse', `${head}^{tree}`) };
}

export function validateRun(run, pr, repository) {
  assert.equal(run.path, workflow);
  assert.equal(run.event, 'pull_request');
  assert.equal(run.head_sha, pr.head.sha);
  assert.equal(run.head_repository.full_name, repository);
  assert.equal(run.repository.full_name, repository);
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');
  assert.ok(
    run.pull_requests.some((entry) => entry.number === pr.number),
    'Run does not belong to release PR',
  );
  assert.ok(Number.isSafeInteger(run.id) && run.id > 0);
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
  return `release-candidate-${pr.head.sha}-${run.id}-${run.run_attempt}`;
}

export function resolveCandidate(tag) {
  validateTag(tag);
  const repository = process.env.GH_REPO;
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
  const prefix = `repos/${repository}`;
  const commit = git('rev-parse', `refs/tags/${tag}^{commit}`);
  assertReleaseSource(tag, commit);
  const associated = pages(`${prefix}/commits/${commit}/pulls?per_page=100`).flat();
  const prs = associated.filter(
    (pr) =>
      pr.merged_at &&
      pr.merge_commit_sha === commit &&
      pr.base.ref === 'main' &&
      pr.base.repo.full_name === repository &&
      pr.head.repo?.full_name === repository,
  );
  assert.equal(prs.length, 1, 'Expected one merged release PR');
  const pr = api(`${prefix}/pulls/${prs[0].number}`);
  assert.equal(pr.merged, true);
  assert.equal(pr.merge_commit_sha, commit);
  execFileSync('git', ['fetch', '--no-tags', 'origin', `refs/pull/${pr.number}/head`], {
    stdio: 'pipe',
  });
  assert.equal(git('rev-parse', 'FETCH_HEAD'), pr.head.sha, 'PR head changed while resolving');
  // Squash changes the commit SHA, never the tested source tree. Changed merge/base fails closed.
  assert.equal(
    git('rev-parse', `${pr.head.sha}^{tree}`),
    git('rev-parse', `${commit}^{tree}`),
    'Merged source differs from tested PR',
  );
  const candidate = inspectCandidate(git('rev-parse', `${commit}^`), pr.head.sha);
  assert.equal(candidate?.version, validateTag(tag));
  // Candidate workflows cannot grant themselves release authority.
  assert.equal(
    git('rev-parse', `${commit}^:${workflow}`),
    git('rev-parse', `${pr.head.sha}:${workflow}`),
  );
  const runs = pages(
    `${prefix}/actions/workflows/release-pr.yml/runs?head_sha=${pr.head.sha}&event=pull_request&per_page=100`,
  )
    .flatMap((page) => page.workflow_runs)
    .sort((a, b) => b.id - a.id);
  assert.ok(runs.length, 'No release PR verification run');
  const run = api(`${prefix}/actions/runs/${runs[0].id}`);
  const name = validateRun(run, pr, repository);
  const checks = pages(`${prefix}/commits/${pr.head.sha}/check-runs?per_page=100`)
    .flatMap((page) => page.check_runs)
    .filter((check) => check.name === 'PR Quality / verify' && check.app?.id === 15368)
    .sort((a, b) => b.id - a.id);
  assert.equal(checks[0]?.conclusion, 'success', 'PR Quality must pass for the candidate');
  const artifacts = pages(`${prefix}/actions/runs/${run.id}/artifacts?per_page=100`)
    .flatMap((page) => page.artifacts)
    .filter((artifact) => artifact.name === name && !artifact.expired);
  assert.equal(artifacts.length, 1, 'Missing or ambiguous immutable candidate artifact');
  assert.equal(artifacts[0].workflow_run.head_sha, pr.head.sha);
  assert.match(artifacts[0].digest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(
    artifacts[0].size_in_bytes > 0 && artifacts[0].size_in_bytes <= 100000000,
    'Candidate archive exceeds bound',
  );
  return {
    commit,
    package_commit: pr.head.sha,
    run_id: run.id,
    artifact_id: artifacts[0].id,
    artifact_name: name,
    artifact_digest: artifacts[0].digest,
    pr: pr.number,
  };
}

export async function downloadCandidate(tag, directory) {
  const candidate = resolveCandidate(tag);
  const bytes = execFileSync(
    'gh',
    ['api', `repos/${process.env.GH_REPO}/actions/artifacts/${candidate.artifact_id}/zip`],
    { timeout: 120000, maxBuffer: 100000000 },
  );
  assert.equal(
    `sha256:${sha256(bytes)}`,
    candidate.artifact_digest,
    'Immutable artifact digest mismatch',
  );
  const read = await readArchive(bytes);
  mkdirSync(directory, { recursive: true });
  // Never extract arbitrary candidate paths into the privileged checkout.
  for (const name of [...assets, 'release-notes.md'])
    writeFileSync(path.join(directory, name), read(name));
  return candidate;
}

// Reconcile only genuinely published versions. Missing/network/auth errors never mean published.
export function publishedPending(pr, releases, tagCommit) {
  if (!pr.merged_at || !pr.labels.some((label) => label.name === 'autorelease: pending'))
    return false;
  return releases.some(
    (release) =>
      !release.draft &&
      !release.prerelease &&
      /^v\d+\.\d+\.\d+$/.test(release.tag_name) &&
      tagCommit(release.tag_name) === pr.merge_commit_sha,
  );
}
export function reconcilePublished() {
  const repository = process.env.GH_REPO;
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
  const prefix = `repos/${repository}`;
  const releases = pages(`${prefix}/releases?per_page=100`).flat();
  const issues = pages(
    `${prefix}/issues?state=closed&labels=autorelease%3A%20pending&per_page=100`,
  ).flat();
  for (const issue of issues.filter((item) => item.pull_request)) {
    const pr = api(`${prefix}/pulls/${issue.number}`);
    if (publishedPending(pr, releases, (tag) => git('rev-parse', `refs/tags/${tag}^{commit}`))) {
      execFileSync(
        'gh',
        [
          'api',
          '--method',
          'DELETE',
          `${prefix}/issues/${pr.number}/labels/autorelease%3A%20pending`,
        ],
        { stdio: 'inherit' },
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, first, second] = process.argv.slice(2);
  let output;
  if (command === 'inspect') output = inspectCandidate(first, second) || {};
  else if (command === 'resolve') output = resolveCandidate(first);
  else if (command === 'download') output = await downloadCandidate(first, second);
  else if (command === 'reconcile') reconcilePublished();
  else throw new Error('Usage: release-candidate.mjs inspect BASE HEAD | resolve TAG | reconcile');
  if (output) {
    console.info(JSON.stringify(output));
    if (process.env.GITHUB_OUTPUT)
      writeFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries(output)
          .map(([key, value]) => `${key}=${value}\n`)
          .join(''),
        { flag: 'a' },
      );
  }
}
