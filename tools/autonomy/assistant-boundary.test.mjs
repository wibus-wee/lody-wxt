import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
test('review preparation has read-only permissions and no signer, endpoint or remote actuation', () => {
  const workflow = read('.github/workflows/pr-review.yml');
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.doesNotMatch(
    workflow,
    /: write|secrets\.|create-github-app-token|DOTS_|AUTONOMY_APP|environment:/,
  );
  const orchestrator = read('tools/autonomy/orchestrate.mjs');
  assert.doesNotMatch(
    orchestrator,
    /method:\s*['"](?:POST|PATCH|PUT|DELETE)|requestDecision|publishAcceptance|DOTS_|'gh'/,
  );
  assert.match(orchestrator, /decision: 'PENDING'/);
  for (const file of ['pr-acceptance.yml', 'acceptance-revoke.yml', 'merge-gate.yml'])
    assert.equal(existsSync(new URL(`../../.github/workflows/${file}`, import.meta.url)), false);
});
test('CI keeps real browser and extension obligations after service removal', () => {
  const workflow = read('.github/workflows/pr-quality.yml');
  for (const command of [
    'pnpm check',
    'pnpm test:browser',
    'pnpm test:assurance',
    'pnpm assurance:audit --strict',
  ])
    assert.ok(workflow.includes(command));
  assert.match(workflow, /ASSURANCE_REPEAT: '5'/);
  const policy = JSON.parse(read('.github/autonomous-maintenance-policy.yml'));
  assert.equal(policy.reviewer, 'connected-assistant');
  assert.deepEqual(policy.requiredChecks, ['PR Quality / verify']);
  assert.equal(policy.strictP0, true);
});
