import assert from 'node:assert/strict';
import { test } from 'node:test';

import { markUiStale } from './ui-evidence.mjs';

test('new head marks old inline images stale without overwriting author content', () => {
  const body =
    'Author content\n<!-- autonomous-ui-evidence:start -->\n![old](https://github.com/old.png)\n<!-- autonomous-ui-evidence:end -->\nAuthor footer';
  const stale = markUiStale(body, 'a'.repeat(40));
  assert.ok(stale.startsWith('Author content\n'));
  assert.ok(stale.endsWith('\nAuthor footer'));
  assert.ok(!stale.includes('![old]'));
  assert.equal(markUiStale(stale, 'a'.repeat(40)), stale);
  assert.throws(
    () => markUiStale(`${body}\n<!-- autonomous-ui-evidence:start -->`, 'a'.repeat(40)),
    /Ambiguous/,
  );
});
