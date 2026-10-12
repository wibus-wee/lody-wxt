import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
    const icon = card.locator('img#icon');
    await expect(icon).toBeVisible();
    await expect
      .poll(() => icon.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const expectedIcon = await readFile(path.join(extension, 'icon/48.png'));
    const matchesArtwork = await icon.evaluate(
      async (element, expected) => {
        const actual = element as HTMLImageElement;
        await actual.decode();
        const reference = new Image();
        reference.src = expected;
        await reference.decode();
        if (
          actual.naturalWidth !== reference.naturalWidth ||
          actual.naturalHeight !== reference.naturalHeight
        )
          return false;
        const pixels = (image: HTMLImageElement) => {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Image pixel comparison requires a canvas context');
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, canvas.width, canvas.height).data;
        };
        const left = pixels(actual);
        const right = pixels(reference);
        return left.every((value, index) => value === right[index]);
      },
      `data:image/png;base64,${expectedIcon.toString('base64')}`,
    );
    expect(matchesArtwork).toBe(true);
    await test.info().attach('installed-extension-icon', {
      body: await card.screenshot(),
      contentType: 'image/png',
    });
    await page.reload();
    await expect(card.locator('img#icon')).toBeVisible();
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
