import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { digest, parsePolicy, shaPattern } from './common.mjs';
import { GitHub } from './github.mjs';

const contextHashPattern = /^[a-f0-9]{64}$/;

// Only metadata on checks owned by the pinned acceptance App is authoritative.
// PR text and artifacts can never supply this record.
export function acceptanceMetadata(context, decision, run) {
  return {
    schemaVersion: 1,
    repository: context.repository,
    pr: context.pr,
    headSha: context.headSha,
    prHeadSha: context.prHeadSha,
    baseSha: context.baseSha,
    bodyDigest: digest(context.body ?? ''),
    policyVersion: context.policyVersion,
    contextHash: decision.contextHash,
    expiresAt: decision.expiresAt,
    runId: run.id,
    runAttempt: run.run_attempt,
    queueBranch: run.event === 'merge_group' ? run.head_branch : null,
  };
}
export function revocationReason(check, metadata, pr, policy, now = Date.now()) {
  if (check.app?.id !== policy.acceptanceAppId || check.name !== 'Autonomy / acceptance')
    return null;
  if (check.conclusion !== 'success') return null;
  if (
    !metadata ||
    metadata.schemaVersion !== 1 ||
    metadata.repository !== policy.repository ||
    metadata.pr !== pr.number ||
    !shaPattern.test(metadata.headSha ?? '') ||
    check.head_sha !== metadata.headSha ||
    !contextHashPattern.test(metadata.contextHash ?? '') ||
    !Number.isSafeInteger(metadata.runId) ||
    !Number.isSafeInteger(metadata.runAttempt)
  )
    return 'Missing or invalid trusted acceptance metadata';
  if (!(Date.parse(metadata.expiresAt) > now)) return 'Acceptance expired';
  if (metadata.policyVersion !== policy.version) return 'Policy changed';
  if (
    pr.state !== 'open' ||
    pr.draft ||
    pr.base.ref !== policy.baseBranch ||
    pr.base.repo.full_name !== policy.repository ||
    pr.head.sha !== metadata.prHeadSha ||
    pr.base.sha !== metadata.baseSha
  )
    return 'PR eligibility or revision changed';
  if (digest(pr.body ?? '') !== metadata.bodyDigest) return 'PR intent changed';
  return null;
}
export async function invalidate(github, policy, event = {}, now = () => Date.now()) {
  assert.ok(Number.isInteger(policy.acceptanceAppId), 'Pinned acceptance App required');
  const prs = await github.pages('/pulls?state=open');
  if (event.pull_request && !prs.some((pr) => pr.number === event.pull_request.number))
    prs.push(event.pull_request);
  const refs = await github.pages(
    `/git/matching-refs/heads/gh-readonly-queue/${policy.baseBranch}/`,
  );
  const shas = new Set([...prs.map((pr) => pr.head.sha), ...refs.map((ref) => ref.object.sha)]);
  if (shaPattern.test(event.before ?? '')) shas.add(event.before);
  let revoked = 0;
  for (const sha of shas) {
    const checks = await github.pages(`/commits/${sha}/check-runs?filter=all`, 'check_runs');
    for (const check of checks) {
      if (
        check.app?.id !== policy.acceptanceAppId ||
        check.name !== 'Autonomy / acceptance' ||
        check.conclusion !== 'success'
      )
        continue;
      let metadata;
      try {
        metadata = JSON.parse(check.output?.text ?? '');
      } catch {
        /* Revoke legacy checks. */
      }
      let reason;
      if (!Number.isSafeInteger(metadata?.pr)) reason = 'Missing trusted acceptance metadata';
      else {
        // Always read current PR state; list/event snapshots cannot authorize freshness.
        const pr = await github.api(`/pulls/${metadata.pr}`);
        reason = revocationReason(
          check,
          metadata,
          pr,
          policy,
          typeof now === 'function' ? now() : now,
        );
        if (!reason && metadata.queueBranch) {
          const expected = `refs/heads/${metadata.queueBranch}`;
          if (!refs.some((ref) => ref.ref === expected && ref.object.sha === check.head_sha))
            reason = 'Queue integration replaced or removed';
        }
      }
      if (reason) {
        await github.api(`/check-runs/${check.id}`, {
          method: 'PATCH',
          body: {
            status: 'completed',
            conclusion: 'failure',
            output: { title: 'Acceptance revoked', summary: reason },
          },
        });
        revoked++;
      }
    }
  }
  return revoked;
}
async function main() {
  const policy = parsePolicy(await readFile('.github/autonomous-maintenance-policy.yml', 'utf8'));
  assert.equal(process.env.GITHUB_REPOSITORY, policy.repository);
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  await invalidate(new GitHub(process.env.GH_TOKEN, policy.repository), policy, event);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
