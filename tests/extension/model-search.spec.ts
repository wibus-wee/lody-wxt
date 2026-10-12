import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { chromium, expect, test } from '@playwright/test';

import { JourneyEvidence } from '../../tools/assurance/evidence';
import { AccountBoundary, signIn } from '../e2e/support/account-boundary';
import { searchConfigModel } from '../e2e/support/model-search-journey';
import { RuntimeBoundary } from '../e2e/support/runtime-boundary';

test('installed sidebar searches legacy-ID ACP models and sends the selected configuration', async () => {
  test.setTimeout(90_000);
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-model-search-'));
  const extension = path.resolve(process.env.LODY_EXTENSION_UNDER_TEST ?? '.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const evidence = new JourneyEvidence('send-and-continue', 'packaged-model-search', 'extension');
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const cloud = new RuntimeBoundary({ searchableModels: { id: 'modelId' } });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await context.route('https://fixture-boundary.invalid/ready', (route) =>
      route.fulfill({ body: 'controlled' }),
    );
    await expect
      .poll(() =>
        worker.evaluate(async () => {
          try {
            return await (await fetch('https://fixture-boundary.invalid/ready')).text();
          } catch {
            return '';
          }
        }),
      )
      .toBe('controlled');
    await new AccountBoundary().install(context);
    await cloud.install(context);
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 400, height: 780 });
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    await signIn(panel);
    await panel.getByRole('button', { name: 'Workspace', exact: true }).click();
    await expect(panel.getByRole('button', { name: '运行配置', exact: true })).toContainText(
      'Controlled model',
    );
    await searchConfigModel(panel, evidence, async (name) => {
      await test.info().attach(name, { body: await panel.screenshot(), contentType: 'image/png' });
    });
    const prompt = 'Use the searched model for this packaged turn';
    await panel.getByRole('textbox', { name: '消息', exact: true }).fill(prompt);
    await panel.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toContainText(
      prompt,
    );
    const session = [
      ...new Set(
        cloud.traffic
          .filter((entry) => entry.stream.startsWith('workspace-a:s:'))
          .map((entry) => entry.stream.slice('workspace-a:s:'.length)),
      ),
    ].find((id) => JSON.stringify(cloud.document(id).getList('history').toJSON()).includes(prompt));
    assert.ok(session);
    await evidence.check('searched-model-reaches-turn', () => {
      expect(cloud.submittedTurn(session).inputConfig).toMatchObject({
        modelId: 'provider/model-29',
        configOptionValues: { modelId: 'provider/model-29' },
      });
    });
  } finally {
    const trace = process.env.ASSURANCE_RUN_DIRECTORY
      ? `${process.env.ASSURANCE_RUN_DIRECTORY}/model-search.trace.zip`
      : test.info().outputPath('model-search.trace.zip');
    await context.tracing.stop({ path: trace });
    await test.info().attach('model-search-trace', { path: trace, contentType: 'application/zip' });
    await evidence.write(
      test.info().status === 'passed' ? 'passed' : 'failed',
      trace,
      test.info().testId,
    );
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
