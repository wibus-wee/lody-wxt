import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assessConfiguration } from './preflight.mjs';
const policy = {
  reviewer: 'connected-assistant',
  mergeStrategy: 'merge-queue',
  baseBranch: 'main',
  ciAppId: 15368,
  version: 'c'.repeat(64),
  requiredChecks: ['PR Quality / verify'],
};
function configuration() {
  const workflows = [
    'pr-quality.yml',
    'pr-evidence.yml',
    'pr-review.yml',
    'release-please.yml',
    'release.yml',
    'release-monitor.yml',
  ];
  return {
    repository: { autoMerge: false, defaultBranch: 'main' },
    protection: {
      required_status_checks: {
        strict: true,
        checks: policy.requiredChecks.map((context) => ({
          context,
          app_id: 15368,
        })),
      },
      enforce_admins: { enabled: true },
      required_linear_history: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_pull_request_reviews: {
        require_code_owner_reviews: false,
        required_approving_review_count: 0,
        require_last_push_approval: false,
      },
    },
    branchRules: [
      { type: 'merge_queue', parameters: { max_entries_to_build: 1, max_entries_to_merge: 1 } },
    ],
    remotePolicy: { version: policy.version },
    workflows: {
      workflows: workflows.map((path) => ({ path: `.github/workflows/${path}`, state: 'active' })),
    },
  };
}

test('connected assistant configuration needs no dedicated App, endpoint or secret', () => {
  assert.equal(assessConfiguration(policy, configuration()).configured, true);
});
test('configuration still rejects stale policy, missing workflows, unverified rules and wrong CI owner', () => {
  for (const mutate of [
    (c) => {
      c.remotePolicy.version = 'stale';
    },
    (c) => {
      c.workflows.workflows = [];
    },
    (c) => {
      c.protection = { blocked: true };
    },
    (c) => {
      c.protection.required_status_checks.checks[0].app_id = 1;
    },
    (c) => {
      c.branchRules = [];
    },
  ]) {
    const c = configuration();
    mutate(c);
    assert.equal(assessConfiguration(policy, c).configured, false);
  }
});
test('personal repository does not need merge queue or a special acceptance check', () => {
  const c = configuration();
  c.branchRules = [];
  assert.equal(
    assessConfiguration({ ...policy, mergeStrategy: 'protected-auto-merge' }, c).configured,
    true,
  );
});

test('single-maintainer review keeps PR-only changes without self-approval deadlock', () => {
  for (const mutate of [
    (c) => {
      c.protection.required_pull_request_reviews = null;
    },
    (c) => {
      c.protection.required_pull_request_reviews.require_code_owner_reviews = true;
    },
    (c) => {
      c.protection.required_pull_request_reviews.required_approving_review_count = 1;
    },
    (c) => {
      c.protection.required_pull_request_reviews.require_last_push_approval = true;
    },
    (c) => {
      c.protection.required_pull_request_reviews.bypass_pull_request_allowances = {
        users: [{}],
        teams: [],
        apps: [],
      };
    },
    (c) => {
      c.protection.required_status_checks.strict = false;
    },
    (c) => {
      c.protection.enforce_admins.enabled = false;
    },
    (c) => {
      c.protection.required_linear_history.enabled = false;
    },
    (c) => {
      c.protection.allow_force_pushes.enabled = true;
    },
    (c) => {
      c.protection.allow_deletions.enabled = true;
    },
    (c) => {
      c.protection.required_status_checks.checks = [];
    },
  ]) {
    const c = configuration();
    mutate(c);
    assert.equal(assessConfiguration(policy, c).configured, false);
  }
  const c = configuration();
  c.protection.required_pull_request_reviews.bypass_pull_request_allowances = {
    users: [],
    teams: [],
    apps: [],
  };
  assert.equal(assessConfiguration(policy, c).configured, true);
  delete c.repository.autoMerge;
  assert.equal(assessConfiguration(policy, c).configured, true);
});
