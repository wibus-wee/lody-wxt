import assert from 'node:assert/strict';

import { acceptanceMetadata } from './invalidate.mjs';
import { mergeStrategyFindings } from './merge-strategy.mjs';

export function mergeGate({
  pr,
  context,
  decision,
  policy,
  checks,
  protection,
  rulesets,
  appId,
  proposedAcceptance = false,
  now = Date.now(),
}) {
  const findings = [];
  const require = (condition, code) => {
    if (!condition) findings.push(code);
  };
  require(pr.state === 'open' && !pr.draft, 'PR_NOT_ELIGIBLE');
  require(pr.body === context.body, 'PR_INTENT_CHANGED');
  require(pr.base.ref === policy.baseBranch &&
    pr.base.repo.full_name === policy.repository, 'WRONG_BASE');
  require(pr.head.sha === context.prHeadSha &&
    pr.base.sha === context.baseSha, 'HEAD_OR_BASE_CHANGED');
  // An in-progress acceptance check itself makes GitHub report blocked.
  // Strict protection still enforces the updated base and required reviews.
  const mergeableStates = ['clean', 'unstable', 'has_hooks'];
  if (policy.mergeStrategy === 'merge-queue') mergeableStates.push('behind');
  require(mergeableStates.includes(pr.mergeable_state) ||
    (proposedAcceptance && pr.mergeable_state === 'blocked'), 'MERGEABILITY_UNVERIFIED');
  require(pr.mergeable === true, 'MERGEABILITY_UNVERIFIED');
  require(decision.decision === 'ACCEPT' &&
    decision.headSha === context.headSha &&
    decision.policyVersion === policy.version, 'NO_CURRENT_ACCEPTANCE');
  require(Date.parse(decision.expiresAt) > now, 'ACCEPTANCE_EXPIRED');
  require(context.impact.risk === 'normal' &&
    !context.impact.protectedFiles.length, 'ELEVATED_APPROVAL_REQUIRED');
  require(policy.acceptanceAppId !== null &&
    appId === policy.acceptanceAppId, 'UNTRUSTED_CHECK_OWNER');
  const required = protection?.required_status_checks;
  require(required?.strict === true &&
    protection?.enforce_admins?.enabled === true, 'BRANCH_PROTECTION_REQUIRED');
  require(protection?.required_linear_history?.enabled === true, 'LINEAR_HISTORY_REQUIRED');
  require(protection?.allow_force_pushes?.enabled === false &&
    protection?.allow_deletions?.enabled === false, 'DESTRUCTIVE_BRANCH_UPDATES_ALLOWED');
  findings.push(
    ...mergeStrategyFindings(
      policy.mergeStrategy,
      Array.isArray(rulesets)
        ? rulesets
            .filter((rule) => rule.enforcement === 'active')
            .flatMap((rule) => rule.rules ?? [])
        : undefined,
    ),
  );
  if (policy.mergeStrategy === 'protected-auto-merge')
    require(context.headSha === context.prHeadSha, 'INTEGRATION_HEAD_NOT_ALLOWED');
  for (const name of policy.requiredChecks) {
    const expectedApp = name === 'Autonomy / acceptance' ? policy.acceptanceAppId : policy.ciAppId;
    require(required?.checks?.some(
      (check) => check.context === name && check.app_id === expectedApp,
    ), `UNPROTECTED_CHECK:${name}`);
    const matching = checks
      .filter(
        (check) =>
          check.name === name &&
          check.head_sha === context.headSha &&
          check.app?.id === expectedApp,
      )
      .sort((a, b) => b.id - a.id);
    require(matching[0]?.status === 'completed' &&
      matching[0]?.conclusion === 'success', `CHECK_NOT_SUCCESS:${name}`);
  }
  return { eligible: findings.length === 0, findings };
}
export function assertMergeAllowed(input) {
  const result = mergeGate(input);
  assert.ok(result.eligible, `Merge blocked: ${result.findings.join(', ')}`);
  return result;
}

// This is the only success publication path. The proposed acceptance check exists
// only in memory until all gates and the final fresh identity reads pass.
export async function publishAcceptance({
  github,
  number,
  check,
  context,
  decision,
  policy,
  run,
  protection,
  rulesets,
  checks,
  summary,
}) {
  const proposedChecks = [
    ...checks.filter((item) => item.id !== check.id),
    {
      ...check,
      head_sha: context.headSha,
      status: 'completed',
      conclusion: 'success',
    },
  ];
  const latest = await github.api(`/pulls/${number}`);
  const gate = {
    context,
    decision,
    policy,
    checks: proposedChecks,
    protection,
    rulesets,
    appId: check.app.id,
    proposedAcceptance: true,
  };
  assertMergeAllowed({ ...gate, pr: latest });
  // Re-read immediately before authority publication, after deterministic checks.
  const fresh = await github.api(`/pulls/${number}`);
  assertMergeAllowed({ ...gate, pr: fresh });
  if (run.event === 'merge_group') {
    const queue = await github.api(`/git/ref/heads/${encodeURIComponent(run.head_branch)}`);
    assert.equal(queue.object.sha, context.headSha, 'Queue integration changed before publication');
  }
  assert.ok(Date.parse(decision.expiresAt) > Date.now(), 'Acceptance expired before publication');
  await github.api(`/check-runs/${check.id}`, {
    method: 'PATCH',
    body: {
      status: 'completed',
      conclusion: 'success',
      output: {
        title: 'ACCEPT',
        summary,
        text: JSON.stringify(acceptanceMetadata(context, decision, run)),
      },
    },
  });
}
