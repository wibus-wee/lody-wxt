import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { chromium, expect, test } from '@playwright/test';

import { JourneyEvidence } from '../../tools/assurance/evidence';
import { AccountBoundary, signIn } from '../e2e/support/account-boundary';
import { RuntimeBoundary } from '../e2e/support/runtime-boundary';

test.use({ trace: 'off' });

test('installed sidebar restores recent sessions and retains expired history', async () => {
  test.setTimeout(90_000);
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-session-resume-'));
  const extension = path.resolve(process.env.LODY_EXTENSION_UNDER_TEST ?? '.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const evidence = new JourneyEvidence('send-and-continue', 'packaged-session-resume', 'extension');
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const cloud = new RuntimeBoundary();
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
    let panel = await context.newPage();
    await panel.setViewportSize({ width: 400, height: 780 });
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    await signIn(panel);
    await panel.getByRole('button', { name: 'Workspace', exact: true }).click();
    await expect(panel.getByRole('button', { name: '运行配置', exact: true })).toContainText(
      'Controlled model',
    );
    const prompt = 'Restore this conversation after closing the sidebar';
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
    const url = panel.url();
    const saved = await panel.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith('lody:chat-resume:'));
      return key ? { key, raw: localStorage.getItem(key)! } : null;
    });
    assert.ok(saved);
    expect(JSON.parse(saved.raw).id).toBe(session);
    const reopen = async (time?: number) => {
      await panel.close();
      panel = await context.newPage();
      await panel.setViewportSize({ width: 400, height: 780 });
      if (time) await panel.clock.setFixedTime(time);
      await panel.goto(url);
      await expect(panel.getByRole('button', { name: '运行配置', exact: true })).toContainText(
        'Controlled model',
      );
    };
    await evidence.check('close-reopen-restores-same-session', async () => {
      await reopen();
      await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toContainText(
        prompt,
      );
      const id = await panel.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).id,
        saved.key,
      );
      expect(id).toBe(session);
    });
    await evidence.check('expiry-keeps-history-accessible', async () => {
      await reopen(Date.now() + 5 * 60 * 1000 + 1000);
      await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(0);
      await panel.getByRole('button', { name: '会话列表', exact: true }).click();
      await expect(panel.locator(`[data-history-id="${session}"]`)).toBeVisible();
      await test
        .info()
        .attach('expired-session-history', {
          body: await panel.screenshot(),
          contentType: 'image/png',
        });
    });
    await evidence.check('history-opens-authoritative-conversation', async () => {
      await panel.locator(`[data-history-id="${session}"]`).click();
      await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toContainText(
        prompt,
      );
      await test
        .info()
        .attach('restored-conversation', {
          body: await panel.screenshot(),
          contentType: 'image/png',
        });
    });
    await evidence.check('explicit-new-prevents-resume', async () => {
      await panel.getByRole('button', { name: '新建会话', exact: true }).click();
      await reopen();
      await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(0);
      expect(await panel.evaluate((key) => localStorage.getItem(key), saved.key)).toBeNull();
    });
    await evidence.check('foreign-scope-does-not-restore', async () => {
      // Seed a record for a different authenticated account/workspace, never the active scope.
      await panel.evaluate(
        ({ key, id }) => {
          localStorage.setItem(
            `${key}:other-account-workspace`,
            JSON.stringify({ id, seenAt: Date.now() }),
          );
        },
        { key: saved.key, id: session },
      );
      await reopen();
      await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(0);
      await panel.getByRole('button', { name: '会话列表', exact: true }).click();
      await expect(panel.locator(`[data-history-id="${session}"]`)).toBeVisible();
    });
  } finally {
    const trace = process.env.ASSURANCE_RUN_DIRECTORY
      ? `${process.env.ASSURANCE_RUN_DIRECTORY}/session-resume.trace.zip`
      : test.info().outputPath('session-resume.trace.zip');
    await context.tracing.stop({ path: trace });
    await test
      .info()
      .attach('session-resume-trace', { path: trace, contentType: 'application/zip' });
    await evidence.write(
      test.info().status === 'passed' ? 'passed' : 'failed',
      trace,
      test.info().testId,
    );
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
