import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { writeCoverageReport } from './report.mjs';

test('release coverage is retained without changing the tracked report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lody-report-output-'));
  try {
    const tracked = join(directory, 'COVERAGE.md');
    const generated = join(directory, 'reports/assurance/COVERAGE.md');
    await writeFile(tracked, 'committed report\n');
    await writeCoverageReport('fresh evidence and warnings\n', generated);
    assert.equal(await readFile(tracked, 'utf8'), 'committed report\n');
    assert.equal(await readFile(generated, 'utf8'), 'fresh evidence and warnings\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
