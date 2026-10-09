import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium, expect, test } from '@playwright/test';
import * as v from 'valibot';

import { AccountBoundary, signIn } from '../e2e/support/account-boundary';
import { RuntimeBoundary } from '../e2e/support/runtime-boundary';

const officialHosts = [
  'https://backend.lody.ai/*',
  'https://convex.lody.ai/*',
  'https://api.lody.ai/*',
  'https://*.streams-api-x.loro.dev/*',
  'https://github.com/wibus-wee/lody-wxt/releases/*',
  'https://release-assets.githubusercontent.com/*',
];
const manifestSchema = v.looseObject({
  permissions: v.array(v.string()),
  optional_host_permissions: v.array(v.string()),
  host_permissions: v.array(v.string()),
  side_panel: v.looseObject({ default_path: v.string() }),
});

test('packaged account login shares workspace identity and signout across sidepanel and options', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-account-extension-'));
  const extension = path.resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    await new AccountBoundary().install(context);
    await new RuntimeBoundary().install(context);
    await context.route('https://backend.lody.ai/api/loro-streams/token', async (route) => {
      const request = v.parse(
        v.object({ workspaceId: v.string() }),
        route.request().postDataJSON(),
      );
      if (request.workspaceId !== 'workspace-b') return route.fallback();
      // Identity switching remains available when the newly selected workspace cannot synchronize.
      return route.fulfill({ status: 503, json: { error: 'controlled_workspace_unavailable' } });
    });
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await signIn(panel);
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html#/account`);
    await expect(options.getByText('已登录：Browser tester', { exact: true })).toBeVisible();
    await expect(options.getByRole('combobox', { name: '工作区', exact: true })).toContainText(
      'Test studio',
    );
    await options.getByRole('combobox', { name: '工作区', exact: true }).click();
    await options.getByRole('option', { name: 'Other studio', exact: true }).click();
    await expect(panel.getByRole('combobox', { name: '工作区', exact: true })).toContainText(
      'Other studio',
    );
    await options.getByRole('button', { name: '退出此设备' }).click();
    await expect(panel.getByRole('button', { name: '登录 Lody', exact: true })).toBeEnabled();
    await expect(panel.getByText('已登录：Browser tester', { exact: true })).toHaveCount(0);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('packaged official hosts are installed while page access stays optional and CSP blocks remote scripts', async () => {
  const extension = path.resolve('.output/chrome-mv3');
  const manifest = v.parse(
    manifestSchema,
    JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8')),
  );
  expect(manifest.permissions).toEqual(
    expect.arrayContaining(['storage', 'activeTab', 'tabs', 'scripting', 'sidePanel']),
  );
  expect(manifest.host_permissions).toEqual(officialHosts);
  expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
  expect(manifest.side_panel.default_path).toBe('sidepanel.html');
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-csp-extension-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    const permissions = await page.evaluate(async () =>
      (
        globalThis as typeof globalThis & {
          chrome: { permissions: { getAll: () => Promise<{ origins?: string[] }> } };
        }
      ).chrome.permissions.getAll(),
    );
    const installedOrigins = officialHosts.map((pattern) => `${new URL(pattern).origin}/*`);
    expect(permissions.origins).toEqual(expect.arrayContaining(installedOrigins));
    expect(permissions.origins).not.toContain('https://*/*');
    const blocked = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          document.addEventListener(
            'securitypolicyviolation',
            (event) => resolve(event.effectiveDirective),
            { once: true },
          );
          const script = document.createElement('script');
          script.src = 'https://scripts.lody.test/remote.js';
          document.head.append(script);
        }),
    );
    expect(blocked).toBe('script-src-elem');
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
