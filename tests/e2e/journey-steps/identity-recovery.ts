import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';

import { When } from '@cucumber/cucumber';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { JourneyWorld } from './world';
import { ready, reopen, restored } from './world';

const requireSdk = createRequire(
  new URL('../../../packages/lody-sdk/package.json', import.meta.url),
);
const { Flock } = requireSdk(
  '@loro-dev/flock-wasm',
) as typeof import('../../../packages/lody-sdk/node_modules/@loro-dev/flock-wasm/nodejs/index');
const composer = (page: Page) => page.getByRole('textbox', { name: '消息', exact: true });
const reply = (page: Page) => page.getByRole('article', { name: 'Agent 消息', exact: true });
const activeQuestion = 'Original workspace question before identity changes';
const otherDraft = 'Question belonging only to Other studio';

async function streamWithRetainedDraft(world: JourneyWorld) {
  await ready(world);
  await composer(world.page).fill(world.draft);
  await reopen(world.page);
  await composer(world.page).fill(activeQuestion);
  await world.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(
    world.page
      .getByRole('article', { name: '你的消息', exact: true })
      .filter({ hasText: activeQuestion }),
  ).toContainText(activeQuestion);
  world.sessionId = 'history-a';
  world.cloud.beginReply(world.sessionId);
  await expect(reply(world.page).last()).toContainText('正在分析网页');
}

async function switchWorkspace(page: Page, name: string) {
  await page.goto('http://127.0.0.1:4173/#/account');
  await page.getByRole('combobox', { name: '工作区', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.getByRole('combobox', { name: '工作区', exact: true })).toContainText(name);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
}

async function installEmptyWorkspace(world: JourneyWorld) {
  const snapshot = new Flock().exportFile();
  await world.context.route('https://backend.lody.ai/api/loro-streams/token', async (route) => {
    const body = route.request().postDataJSON() as { workspaceId: string };
    if (body.workspaceId !== 'workspace-b') return route.fallback();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'workspace-b-stream-token',
        expiresIn: 3600,
        gatewayBaseUrl: 'https://api.lody.ai',
      }),
    });
  });
  await world.context.route('https://convex.lody.ai/api/query', async (route) => {
    const body = route.request().postDataJSON() as { args?: { workspaceId?: string } };
    if (body.args?.workspaceId !== 'workspace-b') return route.fallback();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', value: [] }),
    });
  });
  await world.context.route('https://api.lody.ai/**', async (route) => {
    const url = new URL(route.request().url());
    const stream = decodeURIComponent(url.pathname.split('/')[3] ?? '');
    if (!stream.startsWith('workspace-b:')) return route.fallback();
    assert.equal(route.request().headers().authorization, 'Bearer workspace-b-stream-token');
    if (url.pathname.endsWith('/bootstrap')) {
      await route.fulfill({
        headers: {
          'content-type': 'multipart/mixed; boundary=identity-test',
          'stream-next-offset': '100',
          'stream-snapshot-offset': '100',
          'stream-up-to-date': 'true',
        },
        body: Buffer.concat([
          Buffer.from('--identity-test\r\nContent-Type: application/octet-stream\r\n\r\n'),
          Buffer.from(snapshot),
          Buffer.from('\r\n--identity-test--\r\n'),
        ]),
      });
    } else if (url.searchParams.get('live') === 'sse') {
      await route.fulfill({
        headers: { 'content-type': 'text/event-stream', 'stream-sse-data-encoding': 'base64' },
        body: 'event: control\ndata: {"streamNextOffset":"100","upToDate":true}\n\n',
      });
    } else {
      await route.fulfill({
        headers: {
          'content-type': 'application/octet-stream',
          'stream-next-offset': '100',
          'stream-up-to-date': 'true',
          'stream-ttl': '86400',
        },
        body: '',
      });
    }
  });
}

When(
  'I switch workspaces while my original conversation is streaming',
  async function (this: JourneyWorld) {
    await this.page.clock.install();
    await installEmptyWorkspace(this);
    await streamWithRetainedDraft(this);
    await switchWorkspace(this.page, 'Other studio');
    this.assertions = () =>
      this.evidence.check('old-content-not-in-new-workspace', async () => {
        await expect(composer(this.page)).toHaveValue('');
        await expect(this.page.getByText(activeQuestion, { exact: true })).toHaveCount(0);
        await expect(reply(this.page)).toHaveCount(0);
        await composer(this.page).fill(otherDraft);
        const stored = await this.page.evaluate(() =>
          JSON.parse(localStorage.getItem('lody:account:session')!),
        );
        expect(stored.workspaceId).toBe('workspace-b');
      });
  },
);

When(
  'the original workspace finishes and I return to its saved question',
  async function (this: JourneyWorld) {
    this.cloud.finishReply(this.sessionId);
    await this.evidence.check('late-completion-not-published', async () => {
      const oldReads: string[] = [];
      this.page.on('request', (request) => {
        if (decodeURIComponent(new URL(request.url()).pathname).includes('workspace-a:'))
          oldReads.push(request.url());
      });
      await this.page.clock.runFor(6000);
      expect(oldReads).toEqual([]);
      await expect(composer(this.page)).toHaveValue(otherDraft);
      await expect(reply(this.page)).toHaveCount(0);
      await this.page.reload();
      await expect(composer(this.page)).toHaveValue(otherDraft);
      await expect(reply(this.page)).toHaveCount(0);
      await expect(
        this.page.getByText('网页分析完成：这是一个协作项目。', { exact: true }),
      ).toHaveCount(0);
    });
    await switchWorkspace(this.page, 'Test studio');
    await restored(this.page);
    this.assertions = () =>
      this.evidence.check('return-restores-old-draft', async () => {
        await expect(
          this.page
            .getByRole('article', { name: '你的消息', exact: true })
            .filter({ hasText: activeQuestion }),
        ).toContainText(activeQuestion);
        await expect(reply(this.page).last()).toContainText('网页分析完成：这是一个协作项目。');
        await this.page.getByRole('button', { name: '新建会话', exact: true }).click();
        await expect(composer(this.page)).toHaveValue(this.draft);
        await switchWorkspace(this.page, 'Other studio');
        await expect(composer(this.page)).toHaveValue(otherDraft);
      });
  },
);

When(
  'my authorization expires while a conversation is streaming',
  async function (this: JourneyWorld) {
    await this.page.clock.install();
    await streamWithRetainedDraft(this);
    const remaining = await this.page.evaluate(() => {
      const session = JSON.parse(localStorage.getItem('lody:account:session')!) as {
        expiresAtMs: number;
      };
      return session.expiresAtMs - Date.now();
    });
    assert.ok(remaining > 0);
    await this.page.clock.fastForward(remaining + 1);
    this.assertions = () =>
      this.evidence.check('expiry-revokes-composer', async () => {
        await expect(composer(this.page)).toHaveCount(0);
        await expect(this.page.getByRole('alert')).toContainText('登录已过期');
        await expect
          .poll(() => this.page.evaluate(() => localStorage.getItem('lody:account:session')))
          .toBeNull();
      });
  },
);

When(
  'its late reply arrives and I authorize this device again',
  async function (this: JourneyWorld) {
    this.cloud.finishReply(this.sessionId);
    await this.page.clock.runFor(6000);
    await this.evidence.check('late-response-rejected', async () => {
      await expect(reply(this.page)).toHaveCount(0);
      await expect(composer(this.page)).toHaveCount(0);
      await expect(
        this.page.getByText('网页分析完成：这是一个协作项目。', { exact: true }),
      ).toHaveCount(0);
    });
    const deviceRequests = this.account.requests.filter(
      (entry) => entry.path === '/api/auth/device/code',
    ).length;
    await this.page.clock.setSystemTime(new Date());
    await this.page.reload();
    await expect(this.page.getByRole('button', { name: '登录 Lody', exact: true })).toBeEnabled();
    await expect(composer(this.page)).toHaveCount(0);
    await ready(this);
    this.assertions = () =>
      this.evidence.check('fresh-login-required', async () => {
        expect(
          this.account.requests.filter((entry) => entry.path === '/api/auth/device/code'),
        ).toHaveLength(deviceRequests + 1);
        await expect(reply(this.page).last()).toContainText('网页分析完成：这是一个协作项目。');
        await this.page.getByRole('button', { name: '新建会话', exact: true }).click();
        await expect(composer(this.page)).toHaveValue(this.draft);
      });
  },
);
