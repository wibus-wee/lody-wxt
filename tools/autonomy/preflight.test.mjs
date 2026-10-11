import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assessConfiguration } from './preflight.mjs';

const policy = {
  mergeStrategy: 'merge-queue',
  baseBranch: 'main',
  acceptanceAppId: 91,
  ciAppId: 15368,
  version: 'c'.repeat(64),
  requiredChecks: ['PR Quality / verify', 'Autonomy / acceptance'],
};
function configuration() {
  const workflows = [
    'pr-quality.yml',
    'pr-evidence.yml',
    'pr-acceptance.yml',
    'merge-gate.yml',
    'acceptance-revoke.yml',
    'release-please.yml',
    'release.yml',
    'release-monitor.yml',
  ];
  return {
    repository: { autoMerge: true, defaultBranch: 'main' },
    protection: {
      required_status_checks: {
        strict: true,
        checks: policy.requiredChecks.map((context) => ({
          context,
          app_id: context === 'Autonomy / acceptance' ? 91 : 15368,
        })),
      },
      enforce_admins: { enabled: true },
      required_linear_history: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_pull_request_reviews: { require_code_owner_reviews: true },
    },
    branchRules: [
      { type: 'merge_queue', parameters: { max_entries_to_build: 1, max_entries_to_merge: 1 } },
    ],
    autonomyEnvironment: { deployment_branch_policy: { custom_branch_policies: true } },
    autonomyBranches: { branch_policies: [{ name: 'main', type: 'branch' }] },
    variables: {
      names: ['AUTONOMY_APP_ID', 'AUTONOMY_BOT_LOGIN', 'DOTS_ENDPOINT', 'DOTS_PUBLIC_KEY'],
    },
    repositorySecrets: { blocked: false, names: [] },
    autonomySecrets: { names: ['AUTONOMY_APP_PRIVATE_KEY', 'DOTS_TOKEN', 'AUTONOMY_IMAGE_TOKEN'] },
    releasePromotion: {
      protection_rules: [{ type: 'required_reviewers', reviewers: [{ id: 1 }] }],
    },
    releasePublication: {
      protection_rules: [{ type: 'required_reviewers', reviewers: [{ id: 1 }] }],
    },
    remotePolicy: { version: policy.version },
    workflows: {
      workflows: workflows.map((path) => ({ path: `.github/workflows/${path}`, state: 'active' })),
    },
  };
}
test('preflight requires actual check identities, queue, main-only secret scope and deployed policy', () => {
  assert.equal(assessConfiguration(policy, configuration()).configured, true);
  for (const change of [
    (c) => {
      c.protection.required_status_checks.checks[1].app_id = 1;
    },
    (c) => {
      c.branchRules = [];
    },
    (c) => {
      c.autonomyBranches.branch_policies[0].name = '*';
    },
    (c) => {
      c.repositorySecrets.names.push('AUTONOMY_APP_PRIVATE_KEY');
    },
    (c) => {
      c.remotePolicy.version = 'stale';
    },
    (c) => {
      c.releasePublication.protection_rules = [];
    },
    (c) => {
      c.repositorySecrets = { blocked: true };
    },
  ]) {
    const state = configuration();
    change(state);
    assert.equal(assessConfiguration(policy, state).configured, false);
  }
});
test('personal preflight requires protected checks but no queue or queue workflow', () => {
  const personal = { ...policy, mergeStrategy: 'protected-auto-merge' };
  const state = configuration();
  state.branchRules = [];
  state.workflows.workflows = state.workflows.workflows.filter(
    (workflow) => workflow.path !== '.github/workflows/merge-gate.yml',
  );
  assert.deepEqual(assessConfiguration(personal, state), { configured: true, blockers: [] });
  for (const mutate of [
    (c) => {
      c.branchRules = configuration().branchRules;
    },
    (c) => {
      delete c.branchRules;
    },
    (c) => {
      c.protection.required_status_checks.checks = [];
    },
    (c) => {
      c.protection.required_status_checks.strict = false;
    },
    (c) => {
      c.remotePolicy.version = 'stale';
    },
  ]) {
    const changed = structuredClone(state);
    mutate(changed);
    assert.equal(assessConfiguration(personal, changed).configured, false);
  }
  for (const mergeStrategy of [undefined, 'unknown'])
    assert.ok(
      assessConfiguration({ ...policy, mergeStrategy }, state).blockers.includes(
        'UNKNOWN_MERGE_STRATEGY',
      ),
    );
  const queueState = configuration();
  queueState.workflows.workflows = state.workflows.workflows;
  assert.ok(
    assessConfiguration(policy, queueState).blockers.includes(
      'Protected workflow is not confirmed active: merge-gate.yml',
    ),
  );
});

test('attachments require an environment-only token without an HTTP publisher endpoint', () => {
  const state = configuration();
  assert.equal(state.variables.names.includes('AUTONOMY_IMAGE_ENDPOINT'), false);
  assert.equal(assessConfiguration(policy, state).configured, true);

  state.autonomySecrets.names = state.autonomySecrets.names.filter(
    (name) => name !== 'AUTONOMY_IMAGE_TOKEN',
  );
  assert.ok(
    assessConfiguration(policy, state).blockers.includes(
      'Environment-only secret unverified or absent: AUTONOMY_IMAGE_TOKEN',
    ),
  );

  const unsafe = configuration();
  unsafe.repositorySecrets.names.push('AUTONOMY_IMAGE_TOKEN');
  assert.ok(
    assessConfiguration(policy, unsafe).blockers.includes(
      'Cannot exclude unsafe repository-wide secret scope: AUTONOMY_IMAGE_TOKEN',
    ),
  );

  const unprotected = configuration();
  unprotected.autonomyBranches.branch_policies[0].name = '*';
  assert.equal(assessConfiguration(policy, unprotected).configured, false);
});

test('denied configuration APIs fail closed and remain unknown', () => {
  const result = assessConfiguration(
    { ...policy, acceptanceAppId: null },
    { protection: { blocked: true }, variables: { blocked: true } },
  );
  assert.equal(result.configured, false);
  assert.ok(result.blockers.some((reason) => reason.includes('unverified or absent')));
});
