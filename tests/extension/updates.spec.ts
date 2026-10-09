import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { chromium, expect, test } from '@playwright/test';
import type { browser } from 'wxt/browser';

import type { UpdateState } from '../../src/features/updates/appcast';
import { feedUrl, updateAlarm, updateKey } from '../../src/features/updates/appcast';
import config from '../../src/features/updates/config.json' with { type: 'json' };
import { JourneyEvidence } from '../../tools/assurance/evidence';
import { armInteraction } from '../../tools/assurance/interaction';

test.use({ trace: 'off' });
test('packaged appcast preserves version-pinned downloads, skipped reminders and confirmed metadata across failures and restart', async () => {
  test.setTimeout(120_000);
  const evidence = new JourneyEvidence(
    'discover-and-download-update',
    'packaged-appcast',
    'extension',
  );
  const directory = await mkdtemp(path.join(tmpdir(), 'lody-updates-profile-'));
  const extension = path.resolve('.output/chrome-mv3');
  const installed = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'))
    .version as string;
  const [major = 0, minor = 0] = installed.split('.').map(Number);
  const newer = `${major}.${minor + 1}.0`;
  const newest = `${major}.${minor + 2}.0`;
  const makeFeed = (version: string) => ({
    schemaVersion: config.schemaVersion,
    application: config.application,
    channel: config.channel,
    version,
    releaseNotesUrl: `${config.repository}/releases/tag/v${version}`,
    installationUrl: `${config.repository}/releases/download/v${version}/INSTALL.md`,
    enclosure: {
      url: `${config.repository}/releases/download/v${version}/lody-chrome.zip`,
      length: 4_000_000,
      sha256: 'a'.repeat(64),
      type: 'application/zip',
    },
  });
  let body = makeFeed(installed);
  let status = 200;
  const requests: { method: string; authorization?: string; cookie?: string }[] = [];
  const pageErrors: string[] = [];
  const launch = async () => {
    const context = await chromium.launchPersistentContext(directory, {
      channel: 'chromium',
      headless: true,
      reducedMotion: 'reduce',
      viewport: { width: 400, height: 800 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    await context.route(feedUrl, (route) => {
      const headers = route.request().headers();
      requests.push({
        method: route.request().method(),
        ...(headers.authorization ? { authorization: headers.authorization } : {}),
        ...(headers.cookie ? { cookie: headers.cookie } : {}),
      });
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    return context;
  };
  let context: BrowserContext | undefined;
  const trace = test.info().outputPath('updates.trace.zip');
  try {
    context = await launch();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const settings = await context.newPage();
    settings.on('pageerror', (error) => pageErrors.push(error.message));
    await settings.goto(`chrome-extension://${id}/options.html#/settings`);
    const updates = settings.getByRole('region', { name: '扩展更新', exact: true });
    const check = updates.getByRole('button', { name: '检查更新', exact: true });
    await expect(check).toBeEnabled();
    await check.click();
    await expect(updates).toContainText('已是最新稳定版');
    const panel = await context.newPage();
    panel.on('pageerror', (error) => pageErrors.push(error.message));
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const indicator = panel.getByRole('button', { name: 'Settings', exact: true });
    await expect(panel.getByRole('button', { name: '登录 Lody', exact: true })).toBeVisible();
    await expect(indicator).not.toHaveAttribute('data-update-version');
    const beforeLayout = await panel.locator('header').boundingBox();
    const beforeButtons = await panel.getByRole('button').count();
    body = makeFeed(newer);
    await check.scrollIntoViewIfNeeded();
    const measured = await armInteraction(settings, check, 'update-check', {
      selector: '[aria-label="扩展更新"] output',
      text: `可用版本：${newer}`,
    });
    await check.click();
    await expect(updates).toContainText(`可用版本：${newer}`);
    const sample = await measured();
    expect(sample.status).toBe('observed');
    evidence.interactions.push(sample);
    await evidence.check('trusted-feed-versioned-links', async () => {
      await expect(
        updates.getByRole('link', { name: '下载新版 ZIP', exact: true }),
      ).toHaveAttribute('href', body.enclosure.url);
      await expect(updates.getByRole('link', { name: '更新日志', exact: true })).toHaveAttribute(
        'href',
        body.releaseNotesUrl,
      );
      await expect(updates.getByRole('link', { name: '更新步骤', exact: true })).toHaveAttribute(
        'href',
        body.installationUrl,
      );
      expect(
        await worker.evaluate(
          (name) =>
            (globalThis as typeof globalThis & { chrome: typeof browser }).chrome.alarms.get(name),
          updateAlarm,
        ),
      ).toMatchObject({ periodInMinutes: 360 });
      expect(requests.length).toBeGreaterThan(0);
      expect(
        requests.every(
          (request) => request.method === 'GET' && !request.authorization && !request.cookie,
        ),
      ).toBe(true);
    });
    await evidence.check('quiet-reminder-preserves-chat-layout', async () => {
      await expect(indicator).toHaveAttribute('data-update-version', newer);
      await expect(indicator).toHaveAttribute('aria-description', new RegExp(newer, 'u'));
      expect(await panel.locator('header').boundingBox()).toEqual(beforeLayout);
      expect(await panel.getByRole('button').count()).toBe(beforeButtons);
      await expect(panel.getByLabel('新版扩展可用', { exact: true })).toHaveCount(0);
      await panel.bringToFront();
      await panel.getByRole('button', { name: 'Workspace', exact: true }).focus();
      await panel.keyboard.press('Tab');
      await expect(indicator).toBeFocused();
      await expect(
        panel.getByText(`有新版 ${newer}，打开设置查看更新。`, { exact: true }),
      ).toBeVisible();
      await panel.keyboard.press('Escape');
      await indicator.click();
      await expect(panel.getByRole('region', { name: '扩展更新', exact: true })).toContainText(
        newer,
      );
      await expect(panel.getByRole('link', { name: '下载新版 ZIP', exact: true })).toHaveAttribute(
        'href',
        body.enclosure.url,
      );
      await panel.getByRole('button', { name: 'Workspace', exact: true }).click();
      await expect(panel.getByRole('button', { name: '登录 Lody', exact: true })).toBeVisible();
    });
    await updates.getByRole('button', { name: '跳过此版本', exact: true }).click();
    await evidence.check('skip-persists-across-surfaces-and-reload', async () => {
      await expect(indicator).not.toHaveAttribute('data-update-version');
      await settings.reload();
      await expect(updates).toContainText('已跳过提醒');
      await panel.reload();
      await expect(indicator).not.toHaveAttribute('data-update-version');
    });
    await check.click();
    await evidence.check('manual-check-restores-reminders', async () => {
      await expect(updates).not.toContainText('已跳过提醒');
      await expect(indicator).toHaveAttribute('data-update-version', newer);
      await expect(check).toBeEnabled();
    });
    const readState = () =>
      worker.evaluate(
        async (key) =>
          (
            await (
              globalThis as typeof globalThis & { chrome: typeof browser }
            ).chrome.storage.local.get(key)
          )[key] as UpdateState,
        updateKey,
      );
    const confirmed = await readState();
    status = 503;
    await check.click();
    await evidence.check('failed-check-retains-confirmed-release', async () => {
      await expect(updates).toContainText('HTTP 503');
      await expect(updates).not.toContainText('已是最新稳定版');
      expect((await readState()).checkedAt).toBe(confirmed.checkedAt);
      expect((await readState()).release).toEqual(confirmed.release);
      await expect(
        updates.getByRole('link', { name: '下载新版 ZIP', exact: true }),
      ).toHaveAttribute('href', confirmed.release!.enclosure.url);
    });
    status = 200;
    body = {
      ...makeFeed(newest),
      enclosure: { ...makeFeed(newest).enclosure, url: 'https://untrusted.test/lody.zip' },
    };
    await check.click();
    await evidence.check('invalid-feed-cannot-change-download', async () => {
      await expect(updates).toContainText('更新源格式无效');
      await expect(updates).not.toContainText(newest);
      await expect(
        updates.getByRole('link', { name: '下载新版 ZIP', exact: true }),
      ).toHaveAttribute('href', confirmed.release!.enclosure.url);
      body = makeFeed(installed);
      await check.click();
      await expect(updates).toContainText('更新源版本低于上次确认的版本');
      expect((await readState()).release).toEqual(confirmed.release);
    });
    body = makeFeed(newer);
    await check.click();
    await expect(updates.getByRole('button', { name: '跳过此版本', exact: true })).toBeEnabled();
    await updates.getByRole('button', { name: '跳过此版本', exact: true }).click();
    await expect(updates).toContainText('已跳过提醒');
    body = makeFeed(newest);
    await worker.evaluate(async (key) => {
      const api = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
      const state = (await api.storage.local.get(key))[key] as UpdateState;
      await api.storage.local.set({ [key]: { ...state, lastAttemptAt: 0 } });
    }, updateKey);
    await settings.reload();
    await evidence.check('newer-release-resumes-reminders', async () => {
      await expect(updates).toContainText(`可用版本：${newest}`);
      await expect(indicator).toHaveAttribute('data-update-version', newest);
      const violations = (
        await new AxeBuilder({ page: settings })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations;
      expect(violations).toEqual([]);
      expect(
        (
          await new AxeBuilder({ page: panel })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      await test.info().attach('updates-settings', {
        body: await settings.screenshot(),
        contentType: 'image/png',
      });
    });
    await context.tracing.stop({
      path: test.info().outputPath('updates-before-restart.trace.zip'),
    });
    await context.close();
    context = await launch();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const restartedWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const restartedPage: Page = await context.newPage();
    await evidence.check('profile-restart-retains-update-state', async () => {
      expect(new URL(restartedWorker.url()).host).toBe(id);
      await restartedPage.goto(`chrome-extension://${id}/options.html#/settings`);
      await expect(
        restartedPage.getByRole('region', { name: '扩展更新', exact: true }),
      ).toContainText(`可用版本：${newest}`);
      expect(pageErrors).toEqual([]);
    });
    expect(evidence.checkpoints).toHaveLength(evidence.contract.variant.obligations.length);
  } finally {
    await test.info().attach('updates-journey-evidence', {
      body: JSON.stringify({
        journey: evidence.journey,
        case: evidence.variant,
        installedVersion: installed,
        checkpoints: evidence.checkpoints,
        interactions: evidence.interactions,
      }),
      contentType: 'application/json',
    });
    if (context) {
      await context.tracing.stop({ path: trace });
      await context.close();
    }
    await test.info().attach('appcast-http-requests', {
      body: JSON.stringify(requests),
      contentType: 'application/json',
    });
    await evidence.write(
      test.info().status === 'passed' ? 'passed' : 'failed',
      trace,
      test.info().testId,
    );
    await rm(directory, { recursive: true, force: true });
  }
});
