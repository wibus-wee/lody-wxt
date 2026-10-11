import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { boundedJSON, safePath, text } from './common.mjs';
import { parseMarkdownIntent } from './markdown-intent.mjs';
import { scanDiffSecrets } from './secrets.mjs';

const intentStart = '<!-- autonomous-intent:start -->';
const intentEnd = '<!-- autonomous-intent:end -->';
const jsonFence = '```json';
const closingFence = '```';
const executableLink = /^(?:tests\/|tools\/|https:\/\/github.com\/)/;
const reservedReleaseMetadata =
  /\bRelease-As\s*:|\b(?:BEGIN|END)_COMMIT_OVERRIDE\b|\bBREAKING[ -]CHANGE\s*:/i;
const placeholders = /\b(?:REPLACE_WITH|TODO)\b|\bREPLACE:/i;
const markdownHeadings = /^## (?:What changed\?|Who does this help\?|Scope)\s*$/m;
const capturePlanFile = /^tests\/e2e\/captures\/[\w/-]+\.json$/;
const types = new Set(['feat', 'fix', 'perf', 'refactor', 'docs', 'chore']);
export function parseIntent(body) {
  assert.ok(
    typeof body === 'string' && Buffer.byteLength(body) <= 60000,
    'PR body exceeds intent size bound',
  );
  const begin = body.indexOf(intentStart);
  const finish = body.indexOf(intentEnd);
  if (begin === -1 && finish === -1) return parseMarkdownIntent(body);
  assert.ok(
    !markdownHeadings.test(body),
    'Use one PR description format, not both Markdown and legacy JSON',
  );
  assert.ok(
    begin >= 0 &&
      finish > begin &&
      !body.includes(intentStart, begin + intentStart.length) &&
      !body.includes(intentEnd, finish + intentEnd.length),
    'PR body needs exactly one autonomous-intent JSON block',
  );
  const block = body.slice(begin + intentStart.length, finish).trim();
  assert.ok(
    block.startsWith(jsonFence) && block.endsWith(closingFence),
    'Intent needs one fenced JSON payload',
  );
  return boundedJSON(block.slice(jsonFence.length, -closingFence.length).trim(), 32000).change;
}
export function validateContract(body, impact, model) {
  return validateChange(parseIntent(body), impact, model);
}

export async function resolveIntent(body, readCapturePlan) {
  const change = parseIntent(body);
  if (!change.capture_plan) return change;
  safePath(change.capture_plan);
  assert.ok(
    capturePlanFile.test(change.capture_plan),
    'Capture plan must link a JSON data file under tests/e2e/captures/',
  );
  assert.ok(change.evidence.screenshots.length === 0, 'Use one capture plan source');
  assert.equal(
    typeof readCapturePlan,
    'function',
    'Capture plan must be read from the candidate commit',
  );
  const content = await readCapturePlan(change.capture_plan);
  assert.equal(typeof content, 'string', 'Capture plan reader must return commit-bound text');
  assert.ok(Buffer.byteLength(content) <= 32000, 'Capture plan exceeds size bound');
  assert.ok(
    scanDiffSecrets([
      {
        filename: change.capture_plan,
        patch: content
          .split('\n')
          .map((line) => `+${line}`)
          .join('\n'),
      },
    ]).length === 0,
    'Capture plan contains potential credential material',
  );
  const plans = boundedJSON(content, 32000);
  assert.ok(Array.isArray(plans), 'Capture plan file must contain a plan array');
  change.evidence.screenshots = plans;
  return change;
}

export function validateChange(change, impact, model) {
  assert.ok(change && types.has(change.type), 'Invalid change.type');
  for (const field of [
    'summary',
    'user_impact',
    'expected_path',
    'negative_path',
    'release_note',
  ]) {
    text(change[field], field);
    assert.ok(!placeholders.test(change[field]), `${field} contains a template placeholder`);
  }
  for (const field of ['summary', 'release_note', 'user_impact'])
    assert.ok(
      !reservedReleaseMetadata.test(change[field]),
      `${field} cannot override validated release intent`,
    );
  assert.equal(typeof change.breaking, 'boolean');
  assert.ok(
    Array.isArray(change.surfaces) &&
      change.surfaces.every((surface) =>
        ['web', 'extension', 'docs', 'sdk', 'tooling'].includes(surface),
      ) &&
      change.surfaces.length > 0,
  );
  for (const surface of impact.requiredUiSurfaces ?? [])
    assert.ok(
      change.surfaces.includes(surface),
      `Implicit affected UI surface omitted: ${surface}`,
    );
  const known = new Set(
    model.journeys.flatMap((journey) =>
      journey.cases.map((variant) => `${journey.id}/${variant.id}`),
    ),
  );
  for (const field of ['affected_journeys', 'added_or_updated_journeys']) {
    assert.ok(Array.isArray(change[field]), `${field} must be an array`);
    for (const journey of change[field])
      assert.ok(known.has(journey), `Unknown model case ${journey}`);
  }
  assert.ok(
    change.evidence &&
      typeof change.evidence.e2e === 'boolean' &&
      typeof change.evidence.packaged_extension === 'boolean' &&
      Array.isArray(change.evidence.screenshots),
  );
  if (impact.runtime) {
    assert.ok(!['docs', 'chore'].includes(change.type), 'Type cannot waive runtime evidence');
    assert.ok(
      change.evidence.e2e && change.affected_journeys.length,
      'Runtime changes need real model-derived journey evidence',
    );
    assert.ok(
      change.evidence.packaged_extension,
      'Runtime changes require packaged-extension evidence',
    );
    for (const journey of impact.affectedJourneys)
      assert.ok(
        change.affected_journeys.includes(journey),
        `Implicit affected case omitted: ${journey}`,
      );
  } else text(change.nonvisual_reason, 'nonvisual_reason');
  if (['feat', 'fix'].includes(change.type))
    assert.ok(
      change.added_or_updated_journeys.length,
      'Features and fixes need new or updated regression journeys',
    );
  if (change.type === 'refactor') text(change.unchanged_behavior, 'unchanged_behavior');
  if (change.type === 'perf') {
    assert.ok(
      change.performance &&
        Number.isSafeInteger(change.performance.sample_size) &&
        change.performance.sample_size >= 5,
      'Performance changes need representative samples',
    );
    for (const field of ['baseline', 'environment', 'interaction'])
      text(change.performance[field], `performance.${field}`);
  }
  assert.ok(
    Array.isArray(change.test_links) &&
      change.test_links.length > 0 &&
      change.test_links.every((link) => typeof link === 'string' && executableLink.test(link)),
    'Link executable checks',
  );
  return change;
}
