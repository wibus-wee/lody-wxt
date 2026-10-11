import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { parsePolicy, safePath } from './common.mjs';
import { createEvidence } from './evidence.mjs';

const command = process.argv[2];
if (command === 'evidence') {
  const output = process.argv.includes('--output')
    ? process.argv[process.argv.indexOf('--output') + 1]
    : 'reports/autonomy/evidence.json';
  if (process.argv.length > 3 && (process.argv.length !== 5 || process.argv[3] !== '--output'))
    throw new Error('Usage: evidence [--output reports/path.json]');
  safePath(output);
  if (!output.startsWith('reports/')) throw new Error('Evidence output must be under reports/');
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const ref =
    process.env.AUTONOMY_POLICY_REF ?? event.pull_request?.base.sha ?? event.merge_group?.base_sha;
  if (!ref || !/^[a-f0-9]{40}$/.test(ref)) throw new Error('Trusted base policy SHA is required');
  const policy = parsePolicy(
    execFileSync('git', ['show', `${ref}:.github/autonomous-maintenance-policy.yml`], {
      encoding: 'utf8',
    }),
  );
  const evidence = await createEvidence({
    repo: process.env.GITHUB_REPOSITORY,
    pr: event.pull_request?.number ?? Number(process.env.AUTONOMY_PR_NUMBER ?? 0),
    headSha: event.pull_request?.head.sha ?? event.merge_group?.head_sha ?? process.env.GITHUB_SHA,
    workflowRunId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    event: process.env.GITHUB_EVENT_NAME,
    status: process.env.AUTONOMY_CI_RESULT === 'success' ? 'passed' : 'failed',
    policyVersion: policy.version,
    output,
  });
  await mkdir('reports/autonomy', { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
} else if (command === 'accept') {
  const { orchestrate } = await import('./orchestrate.mjs');
  await orchestrate();
} else if (command === 'preflight') {
  const { preflight } = await import('./preflight.mjs');
  await preflight();
} else throw new Error('Usage: node tools/autonomy/cli.mjs evidence|accept|preflight');
