import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scanDiffSecrets } from './secrets.mjs';

test('high-confidence credential patterns block without disclosing values in findings', () => {
  const credential = `ghp_${'A'.repeat(36)}`;
  const findings = scanDiffSecrets([
    { filename: 'src/client.ts', patch: `+const key = '${credential}';` },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'GITHUB_TOKEN');
  assert.ok(!JSON.stringify(findings).includes(credential));
});
test('deletions and placeholder protocol credentials are not credential exposures', () => {
  assert.deepEqual(
    scanDiffSecrets([
      {
        filename: 'tests/fixture.ts',
        patch: `-const key = 'ghp_${'A'.repeat(36)}';\n+const token = 'test-persistent-token';`,
      },
    ]),
    [],
  );
});
