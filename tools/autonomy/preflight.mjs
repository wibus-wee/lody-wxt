import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { promisify } from 'node:util';

import { parsePolicy } from './common.mjs';
import { mergeStrategyFindings } from './merge-strategy.mjs';

const execute = promisify(execFile);

export function assessConfiguration(policy, results) {
  const blockers = [];
  const require = (condition, reason) => {
    if (!condition) blockers.push(reason);
  };
  require(results.repository?.autoMerge === true, 'Repository auto-merge is not confirmed enabled');
  require(results.repository?.defaultBranch ===
    policy.baseBranch, 'Default branch differs from protected policy');
  require(Number.isInteger(policy.acceptanceAppId) &&
    policy.acceptanceAppId > 0, 'Acceptance App identity is not pinned');
  const protection = results.protection;
  require(protection?.required_status_checks?.strict === true &&
    protection?.enforce_admins?.enabled ===
      true, 'Strict branch checks and administrator enforcement are not confirmed');
  require(protection?.required_linear_history?.enabled === true, 'Linear history is not enforced');
  require(protection?.allow_force_pushes?.enabled === false &&
    protection?.allow_deletions?.enabled ===
      false, 'Force-push/deletion restrictions are not confirmed');
  require(protection?.required_pull_request_reviews?.require_code_owner_reviews ===
    true, 'Protected code-owner approval is not enforced');
  for (const name of policy.requiredChecks) {
    const app = name === 'Autonomy / acceptance' ? policy.acceptanceAppId : policy.ciAppId;
    require(protection?.required_status_checks?.checks?.some(
      (item) => item.context === name && item.app_id === app,
    ), `Required check identity missing: ${name}`);
  }
  blockers.push(...mergeStrategyFindings(policy.mergeStrategy, results.branchRules));
  const branchPolicy = results.autonomyBranches;
  require(results.autonomyEnvironment?.deployment_branch_policy?.custom_branch_policies === true &&
    branchPolicy?.branch_policies?.length === 1 &&
    branchPolicy.branch_policies[0].name === policy.baseBranch &&
    branchPolicy.branch_policies[0].type ===
      'branch', 'Autonomy environment must allow only the exact protected main branch');
  const requiredVariables = [
    'AUTONOMY_APP_ID',
    'AUTONOMY_BOT_LOGIN',
    'DOTS_ENDPOINT',
    'DOTS_PUBLIC_KEY',
  ];
  const requiredSecrets = ['AUTONOMY_APP_PRIVATE_KEY', 'DOTS_TOKEN', 'AUTONOMY_IMAGE_TOKEN'];
  for (const name of requiredVariables)
    require(results.variables?.names?.includes(name), `Variable unverified or absent: ${name}`);
  for (const name of requiredSecrets) {
    require(results.autonomySecrets?.names?.includes(
      name,
    ), `Environment-only secret unverified or absent: ${name}`);
    require(results.repositorySecrets?.blocked === false &&
      !results.repositorySecrets.names.includes(
        name,
      ), `Cannot exclude unsafe repository-wide secret scope: ${name}`);
  }
  for (const name of ['releasePromotion', 'releasePublication'])
    require(results[name]?.protection_rules?.some(
      (rule) => rule.type === 'required_reviewers' && rule.reviewers?.length > 0,
    ), `Independent release environment review unverified: ${name}`);
  require(results.remotePolicy?.version ===
    policy.version, 'Protected main policy differs from this checkout or is not deployed');
  for (const path of [
    'pr-quality.yml',
    'pr-evidence.yml',
    'pr-acceptance.yml',
    ...(policy.mergeStrategy === 'merge-queue' ? ['merge-gate.yml'] : []),
    'acceptance-revoke.yml',
    'release-please.yml',
    'release.yml',
    'release-monitor.yml',
  ])
    require(results.workflows?.workflows?.some(
      (workflow) => workflow.path === `.github/workflows/${path}` && workflow.state === 'active',
    ), `Protected workflow is not confirmed active: ${path}`);
  return { configured: blockers.length === 0, blockers };
}
export async function preflight() {
  const policy = parsePolicy(await readFile('.github/autonomous-maintenance-policy.yml', 'utf8'));
  const prefix = `repos/${policy.repository}`;
  const resources = {
    repository: prefix,
    protection: `${prefix}/branches/${policy.baseBranch}/protection`,
    branchRules: `${prefix}/rules/branches/${policy.baseBranch}`,
    variables: `${prefix}/actions/variables?per_page=100`,
    repositorySecrets: `${prefix}/actions/secrets?per_page=100`,
    autonomyEnvironment: `${prefix}/environments/autonomy`,
    autonomyBranches: `${prefix}/environments/autonomy/deployment-branch-policies`,
    autonomySecrets: `${prefix}/environments/autonomy/secrets?per_page=100`,
    releasePromotion: `${prefix}/environments/release-promotion`,
    releasePublication: `${prefix}/environments/release-publication`,
    remotePolicy: `${prefix}/contents/.github/autonomous-maintenance-policy.yml?ref=${policy.baseBranch}`,
    workflows: `${prefix}/actions/workflows?per_page=100`,
  };
  const results = {};
  // Bound concurrency so credential helpers and rate limits are not flooded.
  const entries = Object.entries(resources);
  for (let offset = 0; offset < entries.length; offset += 3) {
    await Promise.all(
      entries.slice(offset, offset + 3).map(async ([name, path]) => {
        try {
          const { stdout } = await execute('gh', ['api', path], {
            encoding: 'utf8',
            timeout: 45000,
          });
          const value = JSON.parse(stdout);
          if (name.endsWith('Secrets'))
            assert.equal(value.total_count, value.secrets.length, 'Secret metadata was truncated');
          if (name === 'variables')
            assert.equal(
              value.total_count,
              value.variables.length,
              'Variable metadata was truncated',
            );
          results[name] =
            name === 'repository'
              ? {
                  defaultBranch: value.default_branch,
                  autoMerge: value.allow_auto_merge,
                  private: value.private,
                  permissions: value.permissions,
                }
              : name === 'variables'
                ? { names: value.variables.map((item) => item.name) }
                : name.endsWith('Secrets')
                  ? { blocked: false, names: value.secrets.map((item) => item.name) }
                  : name === 'remotePolicy'
                    ? {
                        version: parsePolicy(Buffer.from(value.content, 'base64').toString('utf8'))
                          .version,
                      }
                    : value;
        } catch (error) {
          let reason = 'GitHub request unavailable';
          try {
            reason = JSON.parse(error.stdout?.toString() ?? '').message;
          } catch {
            /* Credential helper stderr is never printed. */
          }
          results[name] = { blocked: true, reason };
        }
      }),
    );
  }
  const report = {
    checkedAt: new Date().toISOString(),
    policyVersion: policy.version,
    results,
    ...assessConfiguration(policy, results),
    note: 'Read-only configuration inspection. Denied APIs mean unknown configuration. No protection, App, secret or rule is installed by this command. Configuration readiness does not demonstrate real remote adversarial pilots or product correctness.',
  };
  await mkdir('reports/autonomy', { recursive: true });
  await writeFile('reports/autonomy/preflight.json', `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.configured) process.exitCode = 1;
  return report;
}
