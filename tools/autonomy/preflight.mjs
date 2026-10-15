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
  require(results.repository?.defaultBranch ===
    policy.baseBranch, 'Default branch differs from protected policy');
  require(policy.reviewer === 'connected-assistant', 'Connected assistant review policy required');
  const protection = results.protection;
  require(protection?.required_status_checks?.strict === true &&
    protection?.enforce_admins?.enabled ===
      true, 'Strict branch checks and administrator enforcement are not confirmed');
  require(protection?.required_linear_history?.enabled === true, 'Linear history is not enforced');
  require(protection?.allow_force_pushes?.enabled === false &&
    protection?.allow_deletions?.enabled ===
      false, 'Force-push/deletion restrictions are not confirmed');
  const reviews = protection?.required_pull_request_reviews;
  require(reviews != null &&
    typeof reviews === 'object', 'Pull-request-only changes are not enforced');
  require(reviews?.require_code_owner_reviews === false &&
    reviews?.required_approving_review_count === 0 &&
    reviews?.require_last_push_approval ===
      false, 'Single-maintainer review settings are not confirmed');
  const bypass = reviews?.bypass_pull_request_allowances;
  require(!bypass ||
    ['users', 'teams', 'apps'].every(
      (kind) => Array.isArray(bypass[kind]) && bypass[kind].length === 0,
    ), 'Pull-request bypass allowances are not permitted');
  for (const name of policy.requiredChecks) {
    const app = policy.ciAppId;
    require(protection?.required_status_checks?.checks?.some(
      (item) => item.context === name && item.app_id === app,
    ), `Required check identity missing: ${name}`);
  }
  blockers.push(...mergeStrategyFindings(policy.mergeStrategy, results.branchRules));
  require(results.remotePolicy?.version ===
    policy.version, 'Protected main policy differs from this checkout or is not deployed');
  for (const path of [
    'pr-quality.yml',
    'pr-evidence.yml',
    'pr-review.yml',
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
          results[name] =
            name === 'repository'
              ? {
                  defaultBranch: value.default_branch,
                  autoMerge: value.allow_auto_merge,
                  private: value.private,
                  permissions: value.permissions,
                }
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
    note: 'Read-only configuration inspection. Denied APIs mean unknown configuration. No protection or credentials are changed. This inspects repository prerequisites only; it cannot prove an assistant subscription exists, semantic review happened, or product correctness.',
  };
  await mkdir('reports/autonomy', { recursive: true });
  await writeFile('reports/autonomy/preflight.json', `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.configured) process.exitCode = 1;
  return report;
}
