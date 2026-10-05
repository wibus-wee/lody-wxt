import assert from 'node:assert/strict';

import AxeBuilder from '@axe-core/playwright';
import {
  After,
  Before,
  Given,
  setDefaultTimeout,
  setWorldConstructor,
  Then,
  When,
  World,
} from '@cucumber/cucumber';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { chromium, expect } from '@playwright/test';

export class WorkspaceWorld extends World {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
}
setWorldConstructor(WorkspaceWorld);
setDefaultTimeout(30_000);
Before(async function (this: WorkspaceWorld) {
  this.browser = await chromium.launch();
  this.context = await this.browser.newContext();
  this.page = await this.context.newPage();
});
After(async function (this: WorkspaceWorld, { result }) {
  if (result?.status === 'FAILED') await this.attach(await this.page.screenshot(), 'image/png');
  await this.context.close();
  await this.browser.close();
});
Given('I open the workspace', async function (this: WorkspaceWorld) {
  await this.page.goto('http://127.0.0.1:4173');
  await expect(this.page.getByRole('heading', { name: 'Lody', exact: true })).toBeVisible();
});
Given('I prefer reduced motion', async function (this: WorkspaceWorld) {
  await this.page.emulateMedia({ reducedMotion: 'reduce' });
});
Given('my stored preferences are corrupted', async function (this: WorkspaceWorld) {
  await this.page.goto('http://127.0.0.1:4173');
  await this.page.evaluate(() => localStorage.setItem('lody:preferences', '{broken'));
});
When('I reload the workspace', async function (this: WorkspaceWorld) {
  await this.page.reload();
});
When('I open Settings', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(this.page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
});
When('I open Intro', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await this.page.getByRole('button', { name: 'Intro', exact: true }).click();
});
When('I return to Workspace', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: 'Workspace', exact: true }).click();
});
When('I save the name {string}', async function (this: WorkspaceWorld, name: string) {
  await this.page.getByRole('textbox', { name: '侧栏名称' }).fill(name);
  await this.page.getByRole('button', { name: '保存名称' }).click();
  if (name.trim()) await expect(this.page.getByRole('button', { name: '保存名称' })).toBeDisabled();
});
When('I enable ambient effects', async function (this: WorkspaceWorld) {
  await this.page.getByRole('switch', { name: '氛围效果' }).click();
  await expect(this.page.getByRole('switch', { name: '氛围效果' })).toBeChecked();
});
When('I continue the introduction', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: '下一步', exact: true }).click();
});
Then('the workspace uses {string} icons', async function (this: WorkspaceWorld, mood: string) {
  await expect(this.page.locator('main')).toHaveAttribute('data-mood', mood);
  const icons = this.page.locator('[data-icon-mood]');
  await expect(icons.first()).toBeVisible();
  for (const icon of await icons.all()) await expect(icon).toHaveAttribute('data-icon-mood', mood);
  await expect(icons.first().locator('svg')).toBeVisible();
});
Then('I see the workspace name {string}', async function (this: WorkspaceWorld, name: string) {
  await this.page.goto('http://127.0.0.1:4173/#/settings');
  await expect(this.page.getByRole('textbox', { name: '侧栏名称', exact: true })).toHaveValue(name);
});
Then('I see a name validation error', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('alert')).toHaveText('请输入侧栏名称。');
});
Then('ambient effects are visible', async function (this: WorkspaceWorld) {
  await expect(this.page.getByTestId('ambient')).toBeVisible();
});
Then('ambient effects are absent', async function (this: WorkspaceWorld) {
  await expect(this.page.getByTestId('ambient')).toHaveCount(0);
});
Then('I see introduction step {string}', async function (this: WorkspaceWorld, title: string) {
  await expect(this.page.getByRole('heading', { name: title, exact: true })).toBeVisible();
});
Then('the page passes accessibility checks', async function (this: WorkspaceWorld) {
  await this.page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const results = await new AxeBuilder({ page: this.page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  assert.deepEqual(results.violations, [], JSON.stringify(results.violations, null, 2));
});
