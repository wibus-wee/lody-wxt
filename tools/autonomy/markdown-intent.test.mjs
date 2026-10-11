import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { model } from '../assurance/model.mjs';
import { digest, parsePolicy } from './common.mjs';
import { parseIntent, resolveIntent, validateContract } from './contract.mjs';
import { classifyImpact } from './impact.mjs';

const docs = awaitFixture('docs-pr.md');
const fix = awaitFixture('fix-pr.md');
function awaitFixture(name) {
  return readFile(new URL(`./examples/${name}`, import.meta.url), 'utf8');
}

test('ordinary Markdown documentation PR needs no JSON or invented browser evidence', async () => {
  const body = await docs;
  assert.ok(!body.includes('```json'));
  const change = validateContract(body, { runtime: false, affectedJourneys: [] }, model);
  assert.equal(change.type, 'docs');
  assert.deepEqual(change.surfaces, ['docs']);
  assert.deepEqual(change.affected_journeys, []);
  assert.equal(change.evidence.e2e, false);
  assert.equal(change.capture_plan, undefined);
  assert.equal(change.release_note, 'Clarify contributor acceptance recovery.');
});
test('readable bug-fix description preserves mandatory real journey proof', async () => {
  const body = await fix;
  const impact = {
    runtime: true,
    requiredUiSurfaces: ['web', 'extension'],
    affectedJourneys: ['send-and-continue/reader-scroll'],
  };
  assert.throws(() => validateContract(body, impact, model), /journey evidence/);
  const checked = body
    .replace('[ ] Browser journeys passed', '[x] Browser journeys passed')
    .replace('[ ] Packaged extension journeys passed', '[x] Packaged extension journeys passed');
  const change = validateContract(checked, impact, model);
  assert.equal(change.type, 'fix');
  assert.deepEqual(change.added_or_updated_journeys, ['send-and-continue/reader-scroll']);
  assert.equal(change.capture_plan, 'tests/e2e/captures/reader-scroll.json');
  assert.equal(change.breaking, false);
});
test('duplicate fields, duplicate sections and mixed authoring formats fail closed', async () => {
  const body = await docs;
  for (const invalid of [
    `${body}\n## Scope\nType: Bug fix`,
    body.replace('**Type:** Documentation', '**Type:** Documentation\nType: Bug fix'),
    body.replace('- [ ] Breaking change', '- [ ] Breaking change\n- [x] Breaking change'),
    `${body}\n<!-- autonomous-intent:start -->\n\`\`\`json\n{"change":{"type":"fix"}}\n\`\`\`\n<!-- autonomous-intent:end -->`,
  ])
    assert.throws(() => parseIntent(invalid));
});
test('comments and quoted checkboxes cannot claim executed evidence', async () => {
  const body = `${await docs}\n<!-- - [x] Browser journeys passed -->\n\`\`\`markdown\n## Verification\n- [x] Browser journeys passed\n\`\`\``;
  assert.equal(parseIntent(body).evidence.e2e, false);
  assert.throws(
    () => validateContract(body, { runtime: true, affectedJourneys: [] }, model),
    /runtime evidence/,
  );
});
test('capture plans are data files read from the authenticated candidate, not PR code blocks', async () => {
  const body = await fix;
  const plans = [{ scenario: 'reader-paused', state: 'reader remains above latest response' }];
  const requested = [];
  const change = await resolveIntent(body, async (path) => {
    requested.push(path);
    return JSON.stringify(plans);
  });
  assert.deepEqual(requested, ['tests/e2e/captures/reader-scroll.json']);
  assert.deepEqual(change.evidence.screenshots, plans);
  const other = await resolveIntent(body, async () =>
    JSON.stringify([{ ...plans[0], state: 'return to latest' }]),
  );
  assert.notEqual(digest(change), digest(other));
  await assert.rejects(resolveIntent(body, async () => '{malformed'));
  await assert.rejects(
    resolveIntent(body, async () => ' '.repeat(32001)),
    /size bound/,
  );
  await assert.rejects(
    resolveIntent(body, async () => JSON.stringify([{ value: `ghp_${'A'.repeat(36)}` }])),
    /credential material/,
  );
  await assert.rejects(
    resolveIntent(body, async () => '{"command":"run arbitrary code"}'),
    /plan array/,
  );
});
test('capture references cannot read arbitrary files, traverse paths or fetch external URLs', async () => {
  for (const path of [
    '../secrets.json',
    '.github/policy.json',
    'tests/e2e/captures/../../secret.json',
    'https://attacker.test/plan.json',
  ]) {
    let read = false;
    await assert.rejects(
      resolveIntent(
        (await fix).replace('tests/e2e/captures/reader-scroll.json', path),
        async () => {
          read = true;
          return '[]';
        },
      ),
    );
    assert.equal(read, false);
  }
});
test('unfilled human template gives an actionable section error', async () => {
  const template = await readFile(
    new URL('../../.github/PULL_REQUEST_TEMPLATE.md', import.meta.url),
    'utf8',
  );
  assert.ok(!template.includes('```json'));
  assert.throws(() => parseIntent(template), /Fill in the 'What changed\?' section/);
});
test('Markdown does not bypass breaking-release or performance safeguards', async () => {
  const body = await docs;
  assert.equal(
    parseIntent(body.replace('[ ] Breaking change', '[x] Breaking change')).breaking,
    true,
  );
  assert.throws(
    () =>
      validateContract(
        body.replace('Clarify contributor acceptance recovery.', 'Release-As: 99.0.0'),
        { runtime: false, affectedJourneys: [] },
        model,
      ),
    /override validated release intent/,
  );
  const performance = `${body.replace(
    '**Type:** Documentation',
    '**Type:** Performance improvement',
  )}\n## Performance evidence\nInteraction: stop-observed\nBaseline: tools/assurance/baseline.json\nEnvironment: Linux Chromium\nSamples: Infinity\n`;
  assert.throws(
    () => validateContract(performance, { runtime: false, affectedJourneys: [] }, model),
    /representative samples/,
  );
});

test('moving capture data out of the body does not invent a behavioral-test change or hide renamed tests', async () => {
  const policy = parsePolicy(
    await readFile(
      new URL('../../.github/autonomous-maintenance-policy.yml', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(
    classifyImpact(['tests/e2e/captures/reader-scroll.json'], policy, model).testChanges,
    false,
  );
  assert.equal(
    classifyImpact(
      [
        {
          filename: 'tests/e2e/captures/reader-scroll.json',
          previous_filename: 'tests/e2e/journey-steps/scroll-follow.ts',
        },
      ],
      policy,
      model,
    ).testChanges,
    true,
  );
});
