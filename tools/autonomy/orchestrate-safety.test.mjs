import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { test } from 'node:test';

import { parsePolicy } from './common.mjs';
import { GitHub } from './github.mjs';
import { orchestrate, resolveRunPullRequest } from './orchestrate.mjs';

test('suspected credential diff escalates before external review or screenshot publication', async (t) => {
  const rawPolicy = await readFile(
    new URL('../../.github/autonomous-maintenance-policy.yml', import.meta.url),
    'utf8',
  );
  const policy = parsePolicy(rawPolicy);
  const head = 'a'.repeat(40);
  const base = 'b'.repeat(40);
  const credential = `ghp_${'A'.repeat(36)}`;
  const writes = [];
  const exitCode = process.exitCode;
  t.after(() => {
    process.exitCode = exitCode;
  });
  const external = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('External transport must not receive suspected credential patches');
  });
  t.mock.method(GitHub.prototype, 'content', async () => rawPolicy);
  t.mock.method(GitHub.prototype, 'pages', async (path) => {
    if (path === '/pulls/4/files')
      return [{ filename: 'src/client.ts', patch: `+const token = '${credential}';` }];
    return [];
  });
  t.mock.method(GitHub.prototype, 'api', async (path, options) => {
    if (options) {
      writes.push({ path, body: options.body });
      if (path === '/check-runs') return { id: 101, app: { id: policy.acceptanceAppId } };
      return {};
    }
    if (path === '/actions/runs/42')
      return {
        id: 42,
        run_attempt: 1,
        path: policy.ciWorkflow,
        event: 'pull_request',
        head_sha: head,
        status: 'completed',
        pull_requests: [{ number: 4 }],
      };
    if (path === '/pulls/4')
      return {
        number: 4,
        state: 'open',
        body: 'Untrusted intent',
        head: { sha: head },
        base: { ref: policy.baseBranch, sha: base, repo: { full_name: policy.repository } },
      };
    if (path.startsWith('/git/commits/')) return { tree: { sha: head } };
    throw new Error(`Unexpected request: ${path}`);
  });
  await orchestrate({
    GITHUB_REPOSITORY: policy.repository,
    GH_TOKEN: 'fixture',
    AUTONOMY_RUN_ID: '42',
    AUTONOMY_BOT_LOGIN: 'fixture-bot',
  });
  assert.equal(external.mock.callCount(), 0);
  assert.equal(process.exitCode, 1);
  const emitted = JSON.stringify(writes);
  assert.ok(!emitted.includes(credential));
  assert.ok(!emitted.includes('const token'));
  assert.ok(emitted.includes('ESCALATE'));
  assert.ok(emitted.includes('GITHUB_TOKEN'));
  assert.ok(emitted.includes('fingerprint'));
  assert.ok(writes.some((write) => write.body.conclusion === 'failure'));
  assert.ok(!writes.some((write) => write.body.conclusion === 'success'));
});

test('stale candidate CI definition blocks evidence, Dots and publication with an actionable rebase', async (t) => {
  const rawPolicy = await readFile(
    new URL('../../.github/autonomous-maintenance-policy.yml', import.meta.url),
    'utf8',
  );
  const policy = parsePolicy(rawPolicy);
  const head = 'a'.repeat(40);
  const base = 'b'.repeat(40);
  const writes = [];
  const reads = [];
  const exitCode = process.exitCode;
  t.after(() => {
    process.exitCode = exitCode;
  });
  const external = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Dots and publication must not run for stale CI definitions');
  });
  const artifacts = t.mock.method(GitHub.prototype, 'artifact', async () => {
    throw new Error('Evidence must not be consumed before workflow authentication');
  });
  t.mock.method(GitHub.prototype, 'content', async (path, ref) => {
    reads.push({ path, ref });
    if (path === policy.ciWorkflow)
      return ref === head ? 'name: stale contributor workflow' : 'name: current protected workflow';
    if (path === '.github/autonomous-maintenance-policy.yml') return rawPolicy;
    throw new Error(`Unexpected content: ${path}`);
  });
  t.mock.method(GitHub.prototype, 'pages', async (path) => {
    if (path === '/pulls/4/files')
      return [{ filename: 'src/client.ts', patch: '+const harmless = true;' }];
    return [];
  });
  t.mock.method(GitHub.prototype, 'api', async (path, options) => {
    if (options) {
      writes.push({ path, body: options.body });
      if (path === '/check-runs') return { id: 101, app: { id: policy.acceptanceAppId } };
      return {};
    }
    if (path === '/actions/runs/42')
      return {
        id: 42,
        run_attempt: 1,
        path: policy.ciWorkflow,
        event: 'pull_request',
        head_sha: head,
        status: 'completed',
        pull_requests: [{ number: 4 }],
      };
    if (path === '/pulls/4')
      return {
        number: 4,
        state: 'open',
        body: 'Untrusted intent',
        head: { sha: head },
        base: { ref: policy.baseBranch, sha: base, repo: { full_name: policy.repository } },
      };
    if (path.startsWith('/git/commits/')) return { tree: { sha: head } };
    throw new Error(`Unexpected API: ${path}`);
  });
  await orchestrate({
    GITHUB_REPOSITORY: policy.repository,
    GH_TOKEN: 'fixture',
    AUTONOMY_RUN_ID: '42',
    AUTONOMY_BOT_LOGIN: 'fixture-bot',
  });
  assert.equal(process.exitCode, 1);
  assert.equal(external.mock.callCount(), 0);
  assert.equal(artifacts.mock.callCount(), 0);
  assert.deepEqual(
    reads.filter(({ path }) => path === policy.ciWorkflow),
    [
      { path: policy.ciWorkflow, ref: head },
      { path: policy.ciWorkflow, ref: base },
    ],
  );
  assert.ok(writes.some(({ body }) => body.conclusion === 'failure'));
  assert.ok(!writes.some(({ body }) => body.conclusion === 'success'));
  assert.ok(!writes.some(({ path }) => path === '/pulls/4'));
  assert.match(JSON.stringify(writes), /rebase onto current main and rerun PR Quality/);
  assert.ok(!JSON.stringify(writes).includes('name: stale contributor workflow'));
  assert.ok(!JSON.stringify(writes).includes('name: current protected workflow'));
});

test('empty fork-run associations resolve only through current authoritative GitHub PRs', async () => {
  const policy = { repository: 'owner/repo', baseBranch: 'main' };
  const head = 'a'.repeat(40);
  const run = { event: 'pull_request', head_sha: head, pull_requests: [] };
  const forkPr = {
    number: 4,
    state: 'open',
    head: { sha: head, repo: { full_name: 'contributor/fork' } },
    base: { ref: 'main', repo: { full_name: policy.repository } },
  };
  const reads = [];
  const github = {
    pages: async (path) => {
      reads.push(path);
      return [{ number: 4 }];
    },
    api: async (path) => {
      reads.push(path);
      return structuredClone(forkPr);
    },
  };
  assert.equal((await resolveRunPullRequest(github, run, policy)).number, 4);
  assert.deepEqual(reads, [`/commits/${head}/pulls`, '/pulls/4']);
  for (const pr of [
    { ...forkPr, state: 'closed' },
    { ...forkPr, head: { ...forkPr.head, sha: 'b'.repeat(40) } },
    { ...forkPr, base: { ...forkPr.base, ref: 'other' } },
    { ...forkPr, base: { ...forkPr.base, repo: { full_name: 'foreign/repo' } } },
  ])
    await assert.rejects(
      resolveRunPullRequest({ ...github, api: async () => pr }, run, policy),
      /current PR association/,
    );
  const ambiguous = {
    pages: async () => [{ number: 4 }, { number: 5 }],
    api: async (path) => ({ ...forkPr, number: Number(path.split('/').at(-1)) }),
  };
  await assert.rejects(resolveRunPullRequest(ambiguous, run, policy), /unambiguous current PR/);
  await assert.rejects(
    resolveRunPullRequest(ambiguous, { ...run, event: 'merge_group' }, policy),
    /single associated PR/,
  );
});
