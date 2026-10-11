import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parsePolicy } from './common.mjs';
import { protectedEvidencePolicy, verifyEvidence } from './evidence.mjs';

const policyPath = '.github/autonomous-maintenance-policy.yml';
const policyText = readFileSync(new URL(`../../${policyPath}`, import.meta.url), 'utf8');
function repository(t) {
  const directory = mkdtempSync(join(tmpdir(), 'lody-evidence-bootstrap-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Evidence fixture');
  git('config', 'user.email', 'fixture@example.test');
  writeFileSync(join(directory, '.gitignore'), 'reports/\n');
  git('add', '.gitignore');
  git('commit', '-qm', 'Protected base before bootstrap');
  const baseSha = git('rev-parse', 'HEAD');
  mkdirSync(join(directory, '.github'));
  return { directory, git, baseSha };
}

test('first bootstrap emits diagnostic evidence without accepting candidate policy as protected', (t) => {
  const { directory, git, baseSha } = repository(t);
  writeFileSync(join(directory, policyPath), policyText);
  git('add', policyPath);
  git('commit', '-qm', 'Candidate bootstrap');
  const headSha = git('rev-parse', 'HEAD');
  assert.equal(protectedEvidencePolicy(baseSha, directory), null);
  const reportDirectory = 'reports/assurance/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  mkdirSync(join(directory, reportDirectory), { recursive: true });
  writeFileSync(
    join(directory, 'reports/assurance/latest.json'),
    JSON.stringify({ directory: reportDirectory }),
  );
  writeFileSync(
    join(directory, reportDirectory, 'run.json'),
    JSON.stringify({ modelHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }),
  );
  writeFileSync(join(directory, reportDirectory, 'audit.json'), JSON.stringify({ cases: [] }));
  const eventPath = join(directory, 'reports/event.json');
  writeFileSync(
    eventPath,
    JSON.stringify({ pull_request: { number: 4, head: { sha: headSha }, base: { sha: baseSha } } }),
  );
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./cli.mjs', import.meta.url)), 'evidence'],
    {
      cwd: directory,
      env: {
        ...process.env,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_RUN_ID: '42',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_EVENT_NAME: 'pull_request',
        AUTONOMY_POLICY_REF: baseSha,
        AUTONOMY_CI_RESULT: 'success',
      },
    },
  );
  const evidence = JSON.parse(
    readFileSync(join(directory, 'reports/autonomy/evidence.json'), 'utf8'),
  );
  assert.equal(evidence.headSha, headSha);
  assert.equal(evidence.policyVersion, null);
  assert.equal(evidence.acceptanceEligible, false);
  assert.throws(
    () => verifyEvidence(evidence, {}, () => undefined),
    /Bootstrap diagnostics cannot authorize acceptance/,
  );
});

test('protected policy hashing preserves exact bytes and ignores a changed candidate copy', (t) => {
  const { directory, git } = repository(t);
  writeFileSync(join(directory, policyPath), policyText);
  git('add', policyPath);
  git('commit', '-qm', 'Install approved policy');
  const protectedSha = git('rev-parse', 'HEAD');
  writeFileSync(join(directory, policyPath), '{}\n');
  assert.deepEqual(protectedEvidencePolicy(protectedSha, directory), parsePolicy(policyText));
});

test('invalid base revisions and malformed installed policies fail instead of becoming bootstrap evidence', (t) => {
  const { directory, git } = repository(t);
  assert.throws(() => protectedEvidencePolicy('not-a-sha', directory), /Trusted base policy SHA/);
  assert.throws(() => protectedEvidencePolicy('f'.repeat(40), directory));
  writeFileSync(join(directory, policyPath), '{broken\n');
  git('add', policyPath);
  git('commit', '-qm', 'Malformed protected fixture');
  assert.throws(() => protectedEvidencePolicy(git('rev-parse', 'HEAD'), directory));
});
