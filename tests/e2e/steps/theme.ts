import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { WorkspaceWorld } from './workspace';

When('I select the Lody theme {string}', async function (this: WorkspaceWorld, theme: string) {
  await this.page.setViewportSize({ width: 360, height: 780 });
  await this.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await this.page.getByRole('combobox', { name: '主题', exact: true }).click();
  await this.page
    .getByRole('option', { name: theme === 'light' ? '浅色' : '深色', exact: true })
    .click();
  await this.page.keyboard.press('Escape');
});
Then('the Lody shell uses theme {string}', async function (this: WorkspaceWorld, theme: string) {
  await expect(this.page.locator('main')).toHaveAttribute('data-theme', theme);
});
