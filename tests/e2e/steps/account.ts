import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { AccountBoundary, authOrigin, configureAccount, signIn } from '../support/account-boundary';
import type { WorkspaceWorld } from './workspace';

const boundaries = new WeakMap<WorkspaceWorld, AccountBoundary>();
Given('a controlled account HTTP server', async function (this: WorkspaceWorld) {
  const server = new AccountBoundary();
  boundaries.set(this, server);
  await server.install(this.context);
});
Given('device authorization requires verification', function (this: WorkspaceWorld) {
  boundaries.get(this)!.pending = true;
});
Given('the account server returns a malformed session', function (this: WorkspaceWorld) {
  boundaries.get(this)!.accountResponse = 'invalid';
});
When('I configure the account server', async function (this: WorkspaceWorld) {
  await configureAccount(this.page);
});
When('I request a device login', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: '登录 Lody', exact: true }).click();
});
Then(
  'I see and approve the device code on the verification page',
  async function (this: WorkspaceWorld) {
    await expect(this.page.getByText('LODY-TEST', { exact: true })).toBeVisible();
    const status = this.page.locator('[data-activity-status]');
    await expect(status).toHaveText('等待登录确认');
    await expect(status).toHaveCSS('font-size', '12px');
    await expect(status.locator('[data-slot="spinner"]')).toHaveCSS('width', '12px');
    const opening = this.context.waitForEvent('page');
    await this.page.getByRole('link', { name: `${authOrigin}/verify`, exact: true }).click();
    const verification = await opening;
    await expect(
      verification.getByRole('heading', { name: 'Device approved by test server' }),
    ).toBeVisible();
    await verification.close();
  },
);
Then('the authenticated workspaces can be selected', async function (this: WorkspaceWorld) {
  await expect(this.page.getByText('已登录：Browser tester', { exact: true })).toBeVisible();
  await this.page.getByRole('combobox', { name: '工作区', exact: true }).click();
  await this.page.getByRole('option', { name: 'Test studio', exact: true }).click();
  await expect(this.page.getByRole('combobox', { name: '工作区', exact: true })).toContainText(
    'Test studio',
  );
});
Given('I sign in and select the test workspace', async function (this: WorkspaceWorld) {
  await signIn(this.page);
});
Then('the invalid session remains an account error', async function (this: WorkspaceWorld) {
  await expect(
    this.page.getByText('无法验证账户。错误代码：invalid_response。', { exact: true }),
  ).toBeVisible();
  await this.page.goto('http://127.0.0.1:4173/#/');
  await expect(
    this.page.getByText('无法验证账户。错误代码：invalid_response。', { exact: true }),
  ).toBeVisible();
  await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveCount(0);
});
