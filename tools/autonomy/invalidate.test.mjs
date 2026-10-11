import assert from 'node:assert/strict';
import { test } from 'node:test';

import { acceptanceMetadata, invalidate, revocationReason } from './invalidate.mjs';

const now = Date.parse('2026-06-01T12:00:00Z');
function fixture() {
  const policy = {
    repository: 'owner/repo',
    baseBranch: 'main',
    version: 'c'.repeat(64),
    acceptanceAppId: 91,
  };
  const pr = {
    number: 4,
    state: 'open',
    draft: false,
    body: 'original',
    head: { sha: 'a'.repeat(40) },
    base: { sha: 'b'.repeat(40), ref: 'main', repo: { full_name: policy.repository } },
  };
  const context = {
    repository: policy.repository,
    pr: pr.number,
    headSha: pr.head.sha,
    prHeadSha: pr.head.sha,
    baseSha: pr.base.sha,
    body: pr.body,
    policyVersion: policy.version,
  };
  const decision = { contextHash: 'd'.repeat(64), expiresAt: new Date(now + 60000).toISOString() };
  const metadata = acceptanceMetadata(context, decision, {
    id: 42,
    run_attempt: 1,
    event: 'pull_request',
  });
  const check = {
    id: 5,
    name: 'Autonomy / acceptance',
    app: { id: 91 },
    head_sha: pr.head.sha,
    conclusion: 'success',
    output: { text: JSON.stringify(metadata) },
  };
  return { policy, pr, metadata, check };
}
test('fresh App-owned acceptance survives; expiry and every identity change revoke', () => {
  const clean = fixture();
  assert.equal(revocationReason(clean.check, clean.metadata, clean.pr, clean.policy, now), null);
  for (const mutate of [
    (f) => {
      f.metadata.expiresAt = new Date(now).toISOString();
    },
    (f) => {
      f.metadata.expiresAt = 'invalid';
    },
    (f) => {
      f.pr.body += ' edited';
    },
    (f) => {
      f.pr.head.sha = 'e'.repeat(40);
    },
    (f) => {
      f.pr.base.sha = 'e'.repeat(40);
    },
    (f) => {
      f.policy.version = 'e'.repeat(64);
    },
    (f) => {
      f.pr.state = 'closed';
    },
    (f) => {
      f.pr.draft = true;
    },
    (f) => {
      f.metadata = null;
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.ok(revocationReason(f.check, f.metadata, f.pr, f.policy, now));
  }
});
test('revoker ignores author-owned lookalike checks even with forged valid metadata', () => {
  const f = fixture();
  f.check.app.id = 123;
  f.pr.body = 'edited';
  assert.equal(revocationReason(f.check, f.metadata, f.pr, f.policy, now), null);
});
test('revoker fetches current body, revokes legacy and expired checks, never writes success', async () => {
  const f = fixture();
  const writes = [];
  const legacy = { ...f.check, id: 6, output: { text: 'author JSON is not metadata' } };
  const foreign = { ...legacy, id: 7, app: { id: 123 } };
  const github = {
    async pages(path) {
      if (path.startsWith('/pulls?')) return [f.pr];
      if (path.startsWith('/git/')) return [];
      return [f.check, legacy, foreign];
    },
    async api(path, options) {
      if (!options) return { ...f.pr, body: 'changed after list read' };
      writes.push({ path, body: options.body });
    },
  };
  assert.equal(await invalidate(github, f.policy, {}, now), 2);
  assert.deepEqual(
    writes.map((write) => write.body.conclusion),
    ['failure', 'failure'],
  );
  assert.ok(writes.every((write) => !write.path.endsWith('/7')));
});
test('synchronization scans previous head and queue integration identities', async () => {
  const f = fixture();
  const old = 'e'.repeat(40);
  const scanned = [];
  const github = {
    async pages(path) {
      if (path.startsWith('/pulls?')) return [f.pr];
      if (path.startsWith('/git/'))
        return [{ ref: 'refs/heads/gh-readonly-queue/main/pr-4', object: { sha: 'f'.repeat(40) } }];
      scanned.push(path);
      return [];
    },
  };
  await invalidate(github, f.policy, { before: old }, now);
  assert.equal(scanned.length, 3);
  assert.ok(scanned.some((path) => path.includes(old)));
  assert.ok(scanned.some((path) => path.includes('f'.repeat(40))));
});
