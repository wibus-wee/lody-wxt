import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateContract } from './contract.mjs';

const change = {
  type: 'docs',
  summary: 'Document maintenance recovery',
  user_impact: 'Contributors can recover from a failed run',
  expected_path: 'Read the documented recovery command',
  negative_path: 'A stale run remains blocked',
  release_note: 'Clarify maintenance recovery',
  breaking: false,
  surfaces: ['docs'],
  affected_journeys: [],
  added_or_updated_journeys: [],
  evidence: { e2e: false, packaged_extension: false, screenshots: [] },
  nonvisual_reason: 'Only Markdown instructions change',
  test_links: ['tools/autonomy/contract-release.test.mjs'],
};
const body = (value) =>
  `<!-- autonomous-intent:start -->\n\`\`\`json\n${JSON.stringify({ change: value })}\n\`\`\`\n<!-- autonomous-intent:end -->`;
const impact = { runtime: false, affectedJourneys: [] };
const model = { journeys: [] };
test('untrusted release notes cannot smuggle version overrides or breaking trailers into a squash commit', () => {
  assert.equal(validateContract(body(change), impact, model).type, 'docs');
  for (const payload of [
    'Clarify behavior\n\nRelease-As: 99.0.0',
    'BREAKING CHANGE: override false flag',
    'BEGIN_COMMIT_OVERRIDE',
  ]) {
    for (const field of ['summary', 'release_note', 'user_impact'])
      assert.throws(
        () => validateContract(body({ ...change, [field]: payload }), impact, model),
        /override validated release intent/,
      );
  }
});
