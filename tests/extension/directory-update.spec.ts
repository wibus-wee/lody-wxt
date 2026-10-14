import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { test } from '@playwright/test';
import * as v from 'valibot';

import { JourneyEvidence } from '../../tools/assurance/evidence';

const resultSchema = v.object({
  passed: v.literal(true),
  invocation: v.string(),
  head: v.string(),
  checkpoints: v.array(v.string()),
  pageErrors: v.array(v.string()),
});

test.use({ trace: 'off' });

test('native directory update retains recovery, account, conversation and unsent draft', async () => {
  test.setTimeout(240_000);
  const info = test.info();
  const evidence = new JourneyEvidence('install-directory-update', 'native-recovery', 'extension');
  const invocation = randomUUID();
  const report = info.outputPath('native-directory');
  const trace = process.env.ASSURANCE_RUN_DIRECTORY
    ? `${process.env.ASSURANCE_RUN_DIRECTORY}/directory-update-${process.env.ASSURANCE_REPETITION ?? '1'}.trace.zip`
    : info.outputPath('directory-update.trace.zip');
  let passed = false;
  try {
    // Separate X display prevents native picker focus from crossing parallel test workers.
    // This child executes the packaged product; no File System API/permission substitution.
    await promisify(execFile)(
      'xvfb-run',
      [
        '--auto-servernum',
        'sh',
        '-c',
        'openbox >"$DIRECTORY_PRODUCT_WINDOW_LOG" 2>&1 & exec "$1" --import tsx tools/update-probe/product.mjs',
        'directory-product',
        process.execPath,
      ],
      {
        timeout: 210_000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          DIRECTORY_PRODUCT_REPORT: report,
          DIRECTORY_PRODUCT_WINDOW_LOG: info.outputPath('window-manager.log'),
          DIRECTORY_PRODUCT_INVOCATION: invocation,
        },
      },
    );
    // Credit only this fresh successful native execution, never an older probe artifact.
    const result = v.parse(
      resultSchema,
      JSON.parse(await readFile(path.join(report, 'result.json'), 'utf8')),
    );
    assert.equal(result.invocation, invocation);
    const head = await promisify(execFile)('git', ['rev-parse', 'HEAD']);
    assert.equal(result.head, head.stdout.trim());
    assert.deepEqual(result.pageErrors, []);
    assert.equal(new Set(result.checkpoints).size, result.checkpoints.length);
    assert.deepEqual(
      [...result.checkpoints].sort(),
      [...evidence.contract.variant.obligations].sort(),
    );
    for (const id of evidence.contract.variant.obligations)
      await evidence.check(id, () => assert.ok(result.checkpoints.includes(id)));
    passed = true;
  } finally {
    try {
      await copyFile(path.join(report, 'product.trace.zip'), trace);
      await info.attach('native-directory-trace', { path: trace, contentType: 'application/zip' });
    } finally {
      await evidence.write(passed ? 'passed' : 'failed', trace, info.testId);
    }
  }
});
