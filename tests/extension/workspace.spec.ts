import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Route } from '@playwright/test';
import { chromium, expect, test } from '@playwright/test';

import { AccountBoundary, signIn } from '../e2e/support/account-boundary';
import { RuntimeBoundary } from '../e2e/support/runtime-boundary';

test('conversation management fits a narrow side panel and keeps list and selected detail distinct', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-conversation-panel-'));
  const extension = path.resolve('.output/chrome-mv3');
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 360, height: 780 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    await new AccountBoundary().install(context);
    await new RuntimeBoundary().install(context);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await signIn(panel);
    const failWorkspaceToken = (route: Route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline"}' });
    await context.route('https://backend.lody.ai/api/loro-streams/token', failWorkspaceToken);
    await panel.goto(`chrome-extension://${id}/sidepanel.html#/conversations`);
    await expect(panel.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Retry connection', exact: true }),
    ).toBeEnabled();
    await context.unroute('https://backend.lody.ai/api/loro-streams/token', failWorkspaceToken);
    await panel.getByRole('button', { name: 'Retry connection', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'New conversation', exact: true }),
    ).toBeEnabled();
    await expect(
      panel.getByRole('button', { name: 'Refresh conversations', exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole('searchbox', { name: 'Search conversations' })).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Historical conversation', exact: true }),
    ).toBeVisible();
    const main = panel.locator('main');
    const bounds = await main.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThanOrEqual(360);
    await expect(
      panel.getByRole('button', { name: 'Historical conversation', exact: true }),
    ).toBeVisible();
    await panel.getByRole('button', { name: 'Historical conversation', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'All conversations', exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Refresh history / check delivery' }),
    ).toBeVisible();
    await expect(panel.getByLabel('Conversation history')).toContainText(
      'controlled HTTP snapshot',
    );
    await expect(panel.getByRole('textbox', { name: 'Message' })).toBeVisible();
    expect(await panel.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
    const violations = (
      await new AxeBuilder({ page: panel }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    ).violations;
    expect(violations).toEqual([]);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('built MV3 popup and options synchronize durable preferences through the service worker', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-extension-'));
  const extension = path.resolve('.output/chrome-mv3');
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const toolbar = await worker.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & {
          chrome: { runtime: { getManifest: () => { action?: { default_popup?: string } } } };
        }
      ).chrome;
      return api.runtime.getManifest().action;
    });
    expect(toolbar?.default_popup).toBeUndefined();
    await expect
      .poll(() =>
        worker.evaluate(async () => {
          const api = (
            globalThis as typeof globalThis & {
              chrome: {
                sidePanel: {
                  getPanelBehavior: () => Promise<{ openPanelOnActionClick?: boolean }>;
                };
              };
            }
          ).chrome;
          return (await api.sidePanel.getPanelBehavior()).openPanelOnActionClick;
        }),
      )
      .toBe(false); // The action listener preserves activeTab before opening the panel.
    const id = new URL(worker.url()).host;
    await worker.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & {
          chrome: {
            storage: { local: { set: (values: Record<string, unknown>) => Promise<void> } };
          };
        }
      ).chrome;
      await api.storage.local.set({
        preferences: { mood: 'glass', displayName: 'Legacy workspace', ambient: false },
      });
    });
    const popup = await context.newPage();
    const options = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await options.goto(`chrome-extension://${id}/options.html#/settings`);
    await expect(popup.locator('main')).toHaveAttribute('data-mood', 'outline');
    await expect(options.locator('main')).toHaveAttribute('data-mood', 'outline');
    await expect(options.getByRole('textbox', { name: '侧栏名称' })).toHaveValue(
      'Legacy workspace',
    );
    await expect(options.getByText('图标风格', { exact: true })).toHaveCount(0);
    await options.getByRole('textbox', { name: '侧栏名称' }).fill('Extension studio');
    await options.getByRole('button', { name: '保存名称' }).click();
    await expect(options.getByRole('button', { name: '保存名称' })).toBeDisabled();
    await expect(popup.getByRole('heading', { name: '让 Lody 陪你浏览' })).toBeVisible();
    await expect(popup.getByRole('textbox', { name: '消息' })).toHaveCount(0);
    await expect(popup.getByRole('button', { name: '打开侧栏' })).toBeEnabled();
    await popup.reload();
    await expect(popup.locator('main')).toHaveAttribute('data-mood', 'outline');
    const backgroundState = await popup.evaluate(async () => {
      const chromeApi = (
        globalThis as typeof globalThis & {
          chrome: {
            runtime: { sendMessage: (message: { type: 'preferences:get' }) => Promise<unknown> };
          };
        }
      ).chrome;
      return chromeApi.runtime.sendMessage({ type: 'preferences:get' });
    });
    expect(backgroundState).toMatchObject({ mood: 'outline', displayName: 'Extension studio' });
    const violations = (
      await new AxeBuilder({ page: popup }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    ).violations;
    expect(violations).toEqual([]);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
