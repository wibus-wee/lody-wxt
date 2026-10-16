import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { chromium, expect } from '@playwright/test';

import { prepareExpiredDirectory } from '../autonomy/capture-directory.mjs';

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), 'lody-native-capture-test-'));
  const installed = path.join(root, 'installed');
  const report = path.resolve('reports/directory-capture');
  await mkdir(report, { recursive: true });
  await cp('.output/chrome-mv3', installed, { recursive: true });
  const manifest = await readFile(path.join(installed, 'manifest.json'));
  const context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
    channel: 'chromium',
    headless: false,
    viewport: { width: 1000, height: 850 },
    args: [`--disable-extensions-except=${installed}`, `--load-extension=${installed}`],
  });
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const result = await prepareExpiredDirectory(
      context,
      origin,
      installed,
      path.join(report, 'fixture'),
      expect,
    );
    const page = await context.newPage();
    await page.goto(`${origin}/options.html#/settings?section=updates`);
    await page.getByRole('button', { name: '安装目录与更新恢复', exact: true }).click();
    await expect(page.getByRole('region', { name: '目录更新', exact: true })).toContainText(
      '安装目录：installed',
    );
    await page.screenshot({ path: path.join(report, 'expired.png'), fullPage: true });
    assert.deepEqual(await readFile(path.join(installed, 'manifest.json')), manifest);
    await writeFile(
      path.join(report, 'result.json'),
      JSON.stringify({ ...result, passed: true, candidate: process.env.CANDIDATE_SHA }, null, 2),
    );
  } finally {
    await context.tracing.stop({ path: path.join(report, 'fixture.trace.zip') });
    await context.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
