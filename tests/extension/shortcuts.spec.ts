import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { chromium, expect, test } from '@playwright/test';

import { JourneyEvidence } from '../../tools/assurance/evidence';
import { AccountBoundary, signIn } from '../e2e/support/account-boundary';
import { RuntimeBoundary } from '../e2e/support/runtime-boundary';

test.use({ trace: 'off' });

test('packaged slash and shortcut manager authorize through the real service worker', async () => {
  test.setTimeout(90_000);
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-shortcuts-profile-'));
  const extension = path.resolve(process.env.LODY_EXTENSION_UNDER_TEST ?? '.output/chrome-mv3');
  const evidence = new JourneyEvidence(
    'synced-shortcuts',
    'packaged-shortcut-entrypoints',
    'extension',
  );
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const cloud = new RuntimeBoundary();
  const diagnostics: string[] = [];
  const workerRequests: {
    url: string;
    method: string;
    authorization: string | undefined;
    workerOwned: boolean;
    body: unknown;
  }[] = [];
  const workerWarnings: string[] = [];
  context.on('console', (message) => {
    if (message.type() === 'warning') workerWarnings.push(message.text());
  });
  try {
    await test.info().attach('packaged-boundary-provenance', {
      body: JSON.stringify({
        workerSha256: createHash('sha256')
          .update(await readFile(path.join(extension, 'background.js')))
          .digest('hex'),
        boundary:
          'Unmodified packaged extension, real browser service worker, SDK and SyncedShortcuts. Only the external Account/Convex/Streams HTTP services are controlled; shortcut bodies/indexes contain real Loro/Flock bytes. No runtime or bridge stubs.',
      }),
      contentType: 'application/json',
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    context.on('request', (request) => {
      if (
        new Set(['https://backend.lody.ai', 'https://convex.lody.ai']).has(
          new URL(request.url()).origin,
        )
      )
        workerRequests.push({
          url: request.url(),
          method: request.method(),
          authorization: request.headers().authorization,
          workerOwned: request.serviceWorker() === worker,
          body: request.postDataJSON(),
        });
    });
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
    panel.on('pageerror', (error) => diagnostics.push(error.message));
    await panel.setViewportSize({ width: 400, height: 780 });
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    await signIn(panel);
    await panel.getByRole('button', { name: 'Workspace', exact: true }).click();
    const input = panel.getByRole('textbox', { name: '消息', exact: true });
    await expect(panel.getByRole('button', { name: '运行配置', exact: true })).toContainText(
      'Controlled model',
    );
    await input.fill('Keep this draft /');
    const list = panel.getByRole('listbox', { name: '提及与命令', exact: true });
    const privateOption = list.getByRole('option', { name: /desktop-private/u });
    let slashFailure = '';
    try {
      await expect(privateOption).toBeVisible({ timeout: 8000 });
      await expect(list.getByRole('option', { name: /team-summary/u })).toBeVisible({
        timeout: 8000,
      });
    } catch (error) {
      slashFailure = error instanceof Error ? error.message : String(error);
    }
    const slashText = (await panel.locator('body').textContent()) ?? '';
    await test.info().attach('packaged-slash', {
      body: await panel.screenshot(),
      contentType: 'image/png',
    });
    await input.press('Escape');
    await panel.getByRole('button', { name: '快捷指令与定时任务', exact: true }).click();
    const privateCard = panel.getByRole('region', {
      name: '快捷指令 Desktop 私有检查',
      exact: true,
    });
    let managerFailure = '';
    try {
      await expect(privateCard).toBeVisible({ timeout: 8000 });
      await expect(
        panel.getByRole('region', { name: '快捷指令 团队共享摘要', exact: true }),
      ).toBeVisible({ timeout: 8000 });
    } catch (error) {
      managerFailure = error instanceof Error ? error.message : String(error);
    }
    const managerText = (await panel.locator('body').textContent()) ?? '';
    await test.info().attach('packaged-manager', {
      body: await panel.screenshot(),
      contentType: 'image/png',
    });
    await test.info().attach('entrypoint-observations', {
      body: JSON.stringify({ slashText, managerText, slashFailure, managerFailure }, null, 2),
      contentType: 'application/json',
    });
    await evidence.check('packaged-slash-discovers-authorized-shortcuts', () => {
      expect(slashFailure, slashText).toBe('');
      expect(slashText).toContain('team-summary');
      expect(slashText).not.toContain('other-private');
      expect(slashText).not.toContain('invalid_request');
    });
    await evidence.check('packaged-manager-discovers-authorized-shortcuts', async () => {
      expect(managerFailure, managerText).toBe('');
      await expect(
        panel.getByRole('region', { name: '快捷指令 团队共享摘要', exact: true }),
      ).toBeVisible();
      expect(managerText).not.toContain('其他成员的私有内容');
      expect(managerText).not.toContain('invalid_request');
    });
    await evidence.check('worker-preserves-resource-scoped-grant-envelope', () => {
      expect(workerRequests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: 'https://backend.lody.ai/api/auth/convex/token',
            method: 'GET',
            authorization: 'Bearer controlled-browser-token',
            workerOwned: true,
          }),
          expect.objectContaining({
            url: 'https://convex.lody.ai/api/action',
            method: 'POST',
            workerOwned: true,
            body: expect.objectContaining({
              path: 'promptShortcuts:getStreamToken',
              format: 'json',
              args: expect.objectContaining({ target: expect.objectContaining({ kind: 'index' }) }),
            }),
          }),
        ]),
      );
      expect(workerRequests.every((request) => request.workerOwned)).toBe(true);
      expect(cloud.shortcuts.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operation: 'listAccessibleDocuments' }),
          {
            operation: 'getStreamToken',
            args: {
              workspaceId: 'workspace-a',
              target: { kind: 'index', ownerUserId: 'user-a', visibility: 'private' },
              write: true,
            },
          },
          {
            operation: 'getStreamToken',
            args: {
              workspaceId: 'workspace-a',
              target: { kind: 'index', ownerUserId: 'user-b', visibility: 'workspace' },
              write: false,
            },
          },
        ]),
      );
      const reads = cloud.shortcuts.traffic.filter((request) => request.method === 'GET');
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.every((request) => request.token.startsWith('shortcut-grant-'))).toBe(true);
      expect(cloud.shortcuts.denied).toEqual([]);
    });
    await panel.getByRole('button', { name: '返回对话', exact: true }).click();
    await input.fill('Keep this draft ');
    await input.fill('Keep this draft /desktop-private');
    await expect(privateOption).toBeVisible();
    await input.press('Enter');
    await evidence.check('packaged-shortcut-insertion-retains-unsent-draft', async () => {
      await expect(input).toHaveValue('Keep this draft 检查这个页面，并给出下一步。 ');
      await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(0);
      expect(
        cloud.traffic.filter(
          (request) => request.kind === 'append' && request.stream.startsWith('workspace-a:s:'),
        ),
      ).toHaveLength(0);
    });
    const beforeReload = workerRequests.length;
    await panel.reload();
    await evidence.check('packaged-shortcut-draft-survives-reload', async () => {
      await expect(input).toHaveValue('Keep this draft 检查这个页面，并给出下一步。 ');
      await expect(panel.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(0);
      expect(diagnostics).toEqual([]);
    });
    await evidence.check('packaged-warm-shortcut-entrypoints-reauthorize', async () => {
      const draft = await input.inputValue();
      await panel.getByRole('button', { name: '快捷指令与定时任务', exact: true }).click();
      await expect(privateCard).toBeVisible();
      await expect(
        panel.getByRole('region', { name: '快捷指令 团队共享摘要', exact: true }),
      ).toBeVisible();
      await expect
        .poll(() => workerRequests.slice(beforeReload))
        .toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              workerOwned: true,
              body: expect.objectContaining({ path: 'promptShortcuts:listAccessibleDocuments' }),
            }),
            expect.objectContaining({
              workerOwned: true,
              body: expect.objectContaining({
                path: 'promptShortcuts:getStreamToken',
                args: expect.objectContaining({
                  target: expect.objectContaining({ kind: 'index' }),
                }),
              }),
            }),
          ]),
        );
      expect(workerRequests.slice(beforeReload).every((request) => request.workerOwned)).toBe(true);
      await panel.getByRole('button', { name: '返回对话', exact: true }).click();
      await input.fill(`${draft}/`);
      await expect(privateOption).toBeVisible();
      await expect(list.getByRole('option', { name: /team-summary/u })).toBeVisible();
      await input.press('Escape');
      await input.fill(draft);
      await expect(input).toHaveValue(draft);
      expect(
        cloud.traffic.filter(
          (request) => request.kind === 'append' && request.stream.startsWith('workspace-a:s:'),
        ),
      ).toHaveLength(0);
    });
    expect(evidence.checkpoints).toHaveLength(evidence.contract.variant.obligations.length);
  } finally {
    await test.info().attach('shortcut-http-observations', {
      body: JSON.stringify(
        {
          requests: cloud.shortcuts.requests,
          traffic: cloud.shortcuts.traffic,
          denied: cloud.shortcuts.denied,
          diagnostics,
          workerRequests,
          workerWarnings,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    const trace = process.env.ASSURANCE_RUN_DIRECTORY
      ? `${process.env.ASSURANCE_RUN_DIRECTORY}/shortcuts.trace.zip`
      : test.info().outputPath('shortcuts.trace.zip');
    await context.tracing.stop({ path: trace });
    await test.info().attach('shortcut-trace', { path: trace, contentType: 'application/zip' });
    await evidence.write(
      test.info().status === 'passed' ? 'passed' : 'failed',
      trace,
      test.info().testId,
    );
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
