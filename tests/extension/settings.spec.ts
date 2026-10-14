import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, test } from '@playwright/test';

test('settings categories adapt to narrow and wide views and retain preferences across reload', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'lody-settings-'));
  const extension = path.resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    ...(process.env.LODY_TEST_CHROMIUM ? { executablePath: process.env.LODY_TEST_CHROMIUM } : {}),
    headless: true,
    reducedMotion: 'reduce',
    viewport: { width: 400, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/options.html#/settings`);
    const navigation = page.getByRole('navigation', { name: '设置分类' });
    await expect(navigation.getByRole('button')).toHaveCount(5);
    await expect(page.getByRole('combobox', { name: '主题' })).toBeHidden();
    await page.screenshot({ path: test.info().outputPath('settings-narrow-index.png') });
    await page.getByRole('button', { name: '通用 外观与浏览器快捷键' }).click();
    await expect(navigation).toBeHidden();
    await expect(page.getByRole('heading', { name: '通用', exact: true })).toBeFocused();
    await page.getByRole('combobox', { name: '主题' }).click();
    await page.getByRole('option', { name: '深色', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.getByRole('combobox', { name: '主题' })).toContainText('深色');
    await page.getByRole('button', { name: '返回设置', exact: true }).click();
    await expect(navigation).toBeVisible();
    await expect(page.getByRole('button', { name: '通用 外观与浏览器快捷键' })).toBeFocused();
    await page.getByRole('button', { name: '隐私与数据 浏览器访问与附件草稿' }).click();
    await expect(page.getByRole('heading', { name: '本地附件草稿' })).toBeVisible();
    await expect(page.getByRole('button', { name: '设置浏览器快捷键' })).toBeHidden();
    await expect(page.getByRole('heading', { name: '回复指令与背景' })).toBeHidden();
    await page.getByRole('button', { name: '返回设置', exact: true }).click();
    await page.getByRole('button', { name: '对话偏好 回复指令与背景' }).click();
    await expect(page.getByRole('heading', { name: '回复指令与背景' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '浏览器访问' })).toBeHidden();
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect(navigation).toBeVisible();
    await expect(page.getByRole('button', { name: '返回设置', exact: true })).toBeHidden();
    await page.getByRole('button', { name: '通用 外观与浏览器快捷键' }).click();
    await page.screenshot({ path: test.info().outputPath('settings-wide-general-dark.png') });
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.getByRole('combobox', { name: '主题' }).click();
    await page.getByRole('option', { name: '浅色', exact: true }).click();
    await page.screenshot({ path: test.info().outputPath('settings-wide-general-light.png') });
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('settings-narrow-general.png') });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
