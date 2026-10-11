import assert from 'node:assert/strict';

import type { BrowserContext, Page, Route } from '@playwright/test';

import { journeyExpect as expect } from '../../../tools/assurance/expect';
export const authOrigin = 'https://backend.lody.ai';
const testToken = 'controlled-browser-token';

export class AccountBoundary {
  requests: { method: string; path: string; authorization: string | undefined; body: unknown }[] =
    [];
  accountResponse: 'valid' | 'invalid' = 'valid';
  pending = false;
  approved = false;

  async install(context: BrowserContext) {
    await context.route(`${authOrigin}/**`, async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const body: unknown = request.postData() ? JSON.parse(request.postData()!) : null;
      this.requests.push({
        method: request.method(),
        path: url.pathname,
        authorization: request.headers().authorization,
        body,
      });
      const respond = (value: object | null, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'authorization,content-type',
            'access-control-allow-methods': 'GET,POST,OPTIONS',
          },
        });
        return;
      }
      if (url.pathname === '/api/auth/device/code') {
        assert.equal(request.method(), 'POST');
        assert.deepEqual(body, { client_id: 'lody-cli' });
        await respond({
          device_code: 'device-browser',
          user_code: 'LODY-TEST',
          verification_uri: `${authOrigin}/verify`,
          verification_uri_complete: `${authOrigin}/verify?user_code=LODY-TEST`,
          expires_in: 300,
          interval: 1,
        });
      } else if (url.pathname === '/verify') {
        this.approved = true;
        await route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>Controlled authorization</title><h1>Device approved by test server</h1>',
        });
      } else if (url.pathname === '/api/auth/device/token') {
        assert.deepEqual(body, {
          client_id: 'lody-cli',
          device_code: 'device-browser',
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        });
        await respond(
          this.pending && !this.approved
            ? { error: 'authorization_pending' }
            : { access_token: testToken, token_type: 'Bearer', expires_in: 3600 },
          this.pending && !this.approved ? 400 : 200,
        );
      } else if (url.pathname === '/api/auth/get-session') {
        assert.equal(request.headers().authorization, `Bearer ${testToken}`);
        await respond(
          this.accountResponse === 'invalid'
            ? { user: { id: 'user-a' }, session: null }
            : {
                user: { id: 'user-a', email: 'test@example.test', name: 'Browser tester' },
                session: {
                  id: 'session-a',
                  userId: 'user-a',
                  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
                },
              },
        );
      } else if (url.pathname === '/api/auth/organization/list') {
        assert.equal(request.headers().authorization, `Bearer ${testToken}`);
        await respond([
          { id: 'workspace-a', name: 'Test studio', slug: 'test-studio' },
          { id: 'workspace-b', name: 'Other studio', slug: 'other-studio' },
        ]);
      } else {
        throw new Error(`Unexpected controlled HTTP request: ${request.method()} ${request.url()}`);
      }
    });
  }
}

export async function configureAccount(page: Page) {
  await page.goto(new URL('#/account', page.url()).href);
  await expect(page.getByRole('button', { name: '登录 Lody', exact: true })).toBeEnabled();
}

export async function signIn(page: Page) {
  await configureAccount(page);
  await page.getByRole('button', { name: '登录 Lody', exact: true }).click();
  await expect(page.getByText('已登录：Browser tester', { exact: true })).toBeVisible();
  await selectWorkspace(page, 'Test studio');
}

async function selectWorkspace(page: Page, name: string) {
  await page.getByRole('combobox', { name: '工作区', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.getByRole('combobox', { name: '工作区', exact: true })).toContainText(name);
}
