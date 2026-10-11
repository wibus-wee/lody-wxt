// A read-only checklist for the connected assistant. This module never publishes
// a check or merges a PR; records supplied by a contributor carry no authority.
import { validateReview } from './acceptance.mjs';
import { mergeStrategyFindings } from './merge-strategy.mjs';

export function mergeGate({
  pr,
  context,
  review,
  policy,
  checks,
  protection,
  rulesets,
  now = Date.now(),
}) {
  const findings = [];
  const require = (condition, reason) => {
    if (!condition) findings.push(reason);
  };
  require(pr.state === 'open' && !pr.draft, 'PR_NOT_ELIGIBLE');
  require(pr.body === context.body, 'PR_INTENT_CHANGED');
  require(pr.base.ref === policy.baseBranch &&
    pr.base.repo.full_name === policy.repository, 'WRONG_BASE');
  require(pr.head.sha === context.prHeadSha &&
    pr.base.sha === context.baseSha, 'HEAD_OR_BASE_CHANGED');
  require(pr.mergeable === true &&
    ['clean', 'unstable', 'has_hooks'].includes(pr.mergeable_state), 'MERGEABILITY_UNVERIFIED');
  require(context.policyVersion === policy.version, 'POLICY_CHANGED');
  require(policy.reviewer === 'connected-assistant', 'UNSUPPORTED_REVIEWER');
  try {
    validateReview(review, context, now);
  } catch {
    findings.push('INVALID_REVIEW_RECORD');
  }
  require(review?.decision === 'ACCEPT', 'NO_CURRENT_REVIEW');
  const required = protection?.required_status_checks;
  require(required?.strict === true &&
    protection?.enforce_admins?.enabled === true, 'BRANCH_PROTECTION_UNVERIFIED');
  require(protection?.required_linear_history?.enabled === true, 'LINEAR_HISTORY_REQUIRED');
  require(protection?.allow_force_pushes?.enabled === false &&
    protection?.allow_deletions?.enabled === false, 'BRANCH_RESTRICTIONS_UNVERIFIED');
  const rules = Array.isArray(rulesets)
    ? rulesets.filter((item) => item.enforcement === 'active').flatMap((item) => item.rules ?? [])
    : undefined;
  findings.push(...mergeStrategyFindings(policy.mergeStrategy, rules));
  if (policy.mergeStrategy === 'protected-auto-merge')
    require(context.headSha === context.prHeadSha, 'INTEGRATION_HEAD_NOT_ALLOWED');
  for (const name of policy.requiredChecks) {
    require(required?.checks?.some(
      (item) => item.context === name && item.app_id === policy.ciAppId,
    ), `UNPROTECTED_CHECK:${name}`);
    const current = checks
      .filter(
        (item) =>
          item.name === name &&
          item.head_sha === context.headSha &&
          item.app?.id === policy.ciAppId,
      )
      .sort((a, b) => b.id - a.id)[0];
    require(current?.status === 'completed' &&
      current?.conclusion === 'success', `CHECK_NOT_SUCCESS:${name}`);
  }
  return { eligible: findings.length === 0, findings };
}
