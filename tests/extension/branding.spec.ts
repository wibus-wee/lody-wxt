import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { BrowserContext } from '@playwright/test';
import { chromium, expect, test } from '@playwright/test';

test('installed extension displays its official icon instead of a browser placeholder', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-branding-'));
  const extension = path.resolve('.output/chrome-mv3');
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const manifest = await worker.evaluate(() => {
      const api = (
        globalThis as typeof globalThis & {
          chrome: {
            runtime: {
              getManifest: () => {
                icons?: Record<string, string>;
                action?: { default_icon?: Record<string, string>; default_popup?: string };
              };
            };
          };
        }
      ).chrome;
      return api.runtime.getManifest();
    });
    expect(manifest.icons).toEqual({
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    });
    expect(manifest.action?.default_icon).toEqual({ 16: 'icon/16.png', 32: 'icon/32.png' });
    expect(manifest.action?.default_popup).toBeUndefined();
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/popup.html`);
    for (const size of [16, 32, 48, 128]) {
      const dimensions = await page.evaluate(async (size) => {
        const image = new Image();
        image.src = `icon/${size}.png`;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      }, size);
      expect(dimensions).toEqual({ width: size, height: size });
    }
    await page.goto('chrome://extensions');
    const card = page.locator('extensions-item').filter({ hasText: 'Lody' });
    await expect(card).toHaveCount(1);
    const icon = card.locator('#icon');
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute('src', new RegExp(`^chrome://extension-icon/${id}/`));
    await expect
      .poll(() => icon.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await test.info().attach('installed-extension-icon', {
      body: await card.screenshot(),
      contentType: 'image/png',
    });
    await page.reload();
    await expect(card.locator('#icon')).toBeVisible();
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
