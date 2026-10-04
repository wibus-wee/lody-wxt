import assert from 'node:assert/strict';

import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { WorkspaceWorld } from './workspace';

Then('the cloud history uses the Lody chat surface', async function (this: WorkspaceWorld) {
  const transcript = this.page.getByRole('region', { name: '消息记录', exact: true });
  await expect(transcript.getByRole('article', { name: '你的消息', exact: true })).toContainText(
    'Previously asked question',
  );
  const reply = transcript.getByRole('article', { name: 'Agent 消息', exact: true });
  await expect(reply).toContainText('Answer restored from real Loro snapshot');
  await expect(reply.getByRole('heading', { name: 'Cloud history', exact: true })).toBeVisible();
  await expect(reply.getByRole('table')).toHaveCount(1);
  await expect(reply.locator('script')).toHaveCount(0);
  await expect(reply.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(this.page.getByTestId('composer')).toBeVisible();
  await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toBeEnabled();
});
When('I wrap the cloud reply code', async function (this: WorkspaceWorld) {
  await this.page.setViewportSize({ width: 360, height: 780 });
  await this.page.getByRole('button', { name: '代码自动换行', exact: true }).first().click();
  await expect(
    this.page.locator('[data-streamdown="code-block"]').first().locator('pre'),
  ).toHaveCSS('white-space', 'pre-wrap');
});
Then('the cloud transcript stays inside a narrow sidebar', async function (this: WorkspaceWorld) {
  const transcript = this.page.getByRole('region', { name: '消息记录', exact: true });
  assert.equal(
    await transcript.evaluate((element) => element.scrollWidth > element.clientWidth),
    false,
  );
  const composer = await this.page.getByTestId('composer').boundingBox();
  assert.ok(composer && composer.x >= 0 && composer.x + composer.width <= 360);
});

Then('the quick chat is ready without setup', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('button', { name: '运行配置', exact: true })).toContainText(
    'Controlled model',
  );
  await expect(this.page.getByRole('dialog')).toHaveCount(0);
  await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toBeEnabled();
});
When('I start a fresh quick chat', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(this.page.getByRole('heading', { name: '有什么想聊的？' })).toBeVisible();
  await expect(this.page.getByRole('dialog')).toHaveCount(0);
});
Then('no empty conversation has been created', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: '会话列表', exact: true }).click();
  const history = this.page.getByRole('dialog');
  await expect(history.getByRole('button')).toHaveCount(1);
  await expect(
    history.getByRole('button', { name: 'Historical conversation', exact: true }),
  ).toBeVisible();
  await this.page.keyboard.press('Escape');
  const journals = await this.page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('lody:real-create:')),
  );
  assert.deepEqual(journals, []);
});
When('I write the quick draft {string}', async function (this: WorkspaceWorld, text: string) {
  await this.page.getByRole('textbox', { name: '消息', exact: true }).fill(text);
});
Then('the quick draft is {string}', async function (this: WorkspaceWorld, text: string) {
  await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(text);
});
When('I search quick history for {string}', async function (this: WorkspaceWorld, text: string) {
  if (!(await this.page.getByRole('textbox', { name: '搜索对话' }).isVisible()))
    await this.page.getByRole('button', { name: '会话列表', exact: true }).click();
  await this.page.getByRole('textbox', { name: '搜索对话' }).fill(text);
});
Then('quick history has no matches', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('dialog').getByRole('status')).toHaveText('没有找到相关对话');
});
When('I open the matching quick conversation', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: 'Historical conversation', exact: true }).click();
});
When('I write a long draft in a short sidebar', async function (this: WorkspaceWorld) {
  await this.page.setViewportSize({ width: 320, height: 480 });
  await this.page
    .getByRole('textbox', { name: '消息', exact: true })
    .fill('A long thought to keep.\n'.repeat(40));
});
Then('the quick chat controls fit the viewport', async function (this: WorkspaceWorld) {
  for (const name of ['发送消息', '新建会话', '会话列表']) {
    const box = await this.page.getByRole('button', { name, exact: true }).boundingBox();
    assert.ok(
      box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 320 && box.y + box.height <= 480,
    );
  }
  assert.equal(
    await this.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
});
When('I send the quick draft', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: '发送消息', exact: true }).click();
});
Then('the first quick message is in the transcript', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('article', { name: '你的消息', exact: true })).toContainText(
    'A new browser question',
  );
  await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('');
});

When(
  'I reopen a sidebar with an old empty reservation and a webpage draft',
  async function (this: WorkspaceWorld) {
    await this.page.setViewportSize({ width: 360, height: 780 });
    await expect(this.page.getByRole('button', { name: '运行配置', exact: true })).toContainText(
      'Controlled model',
    );
    const scope = await this.page.evaluate(() =>
      Object.keys(localStorage)
        .find((key) => key.startsWith('lody:chat-draft:') && key.endsWith(':new'))
        ?.slice('lody:chat-draft:'.length, -':new'.length),
    );
    assert.ok(scope);
    await this.page.addInitScript((scope) => {
      localStorage.setItem(
        `lody:real-create:${scope}`,
        JSON.stringify({
          scope,
          metadata: {
            id: 'legacy-empty',
            machineId: 'machine-a',
            agentConfigId: 'agent-a',
            userId: 'user-a',
            createdAt: '2026-01-01T00:00:00.000Z',
            isArchived: false,
          },
        }),
      );
      localStorage.setItem(
        `lody:chat-draft:${scope}:new`,
        JSON.stringify({
          text: 'A new browser question',
          contexts: [
            {
              id: 'page-long-title',
              kind: 'page',
              title:
                'LodyAI/Lody: Share coding agents with your team on phone and desktop — '.repeat(5),
              url: 'https://example.com/long-page',
              text: 'Page contents',
              trust: 'untrusted',
            },
          ],
        }),
      );
    }, scope);
    await this.page.reload();
  },
);
Then('the unsent draft has no recovery warning', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
    'A new browser question',
  );
  await expect(this.page.getByRole('alert')).toHaveCount(0);
  await expect(this.page.getByRole('button', { name: '确认发送结果', exact: true })).toHaveCount(0);
  await expect(this.page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
});
Then('the attached message fits narrow sidebars', async function (this: WorkspaceWorld) {
  for (const width of [320, 360, 420]) {
    await this.page.setViewportSize({ width, height: 780 });
    const article = this.page.getByRole('article', { name: '你的消息', exact: true });
    const attachment = article.getByLabel('附加的网页');
    await expect(attachment).toContainText('LodyAI/Lody');
    const bounds = await article.boundingBox();
    const chip = await attachment.boundingBox();
    assert.ok(
      bounds && chip && chip.x >= bounds.x && chip.x + chip.width <= bounds.x + bounds.width + 1,
    );
    assert.equal(
      await this.page
        .getByRole('region', { name: '消息记录', exact: true })
        .evaluate((node) => node.scrollWidth > node.clientWidth),
      false,
    );
    assert.equal(
      await this.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
});
