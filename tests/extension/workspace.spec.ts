import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext } from '@playwright/test';
import { chromium, expect, test } from '@playwright/test';

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
    const ambient = options.getByRole('switch', { name: '背景动态效果', exact: true });
    await expect(ambient).not.toBeChecked();
    await ambient.click();
    await expect(ambient).toBeChecked();
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
    expect(backgroundState).toMatchObject({ mood: 'outline', ambient: true });
    await options.reload();
    await expect(ambient).toBeChecked();
    await popup.bringToFront();
    const violations = (
      await new AxeBuilder({ page: popup }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    ).violations;
    expect(violations).toEqual([]);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
