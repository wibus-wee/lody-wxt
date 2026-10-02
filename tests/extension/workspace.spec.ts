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
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    const options = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await options.goto(`chrome-extension://${id}/options.html#/settings`);
    await popup.getByRole('button', { name: 'glass', exact: true }).click();
    await expect(popup.locator('main')).toHaveAttribute('data-mood', 'glass');
    await expect(options.locator('main')).toHaveAttribute('data-mood', 'glass');
    await options.getByRole('textbox', { name: 'Workspace name' }).fill('Extension studio');
    await options.getByRole('button', { name: 'Save name' }).click();
    await expect(popup.getByRole('heading', { name: 'Extension studio' })).toBeVisible();
    await popup.reload();
    await expect(popup.locator('main')).toHaveAttribute('data-mood', 'glass');
    const backgroundState = await popup.evaluate(async () => {
      const chromeApi = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage: (message: unknown) => Promise<unknown> } };
        }
      ).chrome;
      return chromeApi.runtime.sendMessage({ type: 'preferences:get' });
    });
    expect(backgroundState).toMatchObject({ mood: 'glass', displayName: 'Extension studio' });
    const violations = (
      await new AxeBuilder({ page: popup }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    ).violations;
    expect(violations).toEqual([]);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
