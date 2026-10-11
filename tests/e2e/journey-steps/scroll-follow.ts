import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import AxeBuilder from '@axe-core/playwright';
import { When } from '@cucumber/cucumber';
import type { Page } from '@playwright/test';

import { journeyExpect as expect } from '../../../tools/assurance/expect';
import type { JourneyWorld } from './world';
import { ready, restored, selectFixtureConversation } from './world';

const requireSdk = createRequire(
  new URL('../../../packages/lody-sdk/package.json', import.meta.url),
);
const { LoroMap, LoroList, LoroText } = requireSdk(
  'loro-crdt',
) as typeof import('../../../packages/lody-sdk/node_modules/loro-crdt');
const transcript = (page: Page) => page.getByRole('region', { name: '消息记录', exact: true });
const jump = (page: Page) => page.getByRole('button', { name: '回到最新', exact: true });
const composer = (page: Page) => page.getByRole('textbox', { name: '消息', exact: true });
const longAnswer = Array.from(
  { length: 60 },
  (_, index) => `第 ${index + 1} 段：阅读位置应该由读者决定，后续输出不应打断当前阅读。`,
).join('\n\n');

async function geometry(page: Page) {
  return transcript(page).evaluate((element) => ({
    top: element.scrollTop,
    height: element.clientHeight,
    below: Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop),
  }));
}

async function atBottom(page: Page) {
  await expect.poll(async () => (await geometry(page)).below).toBeLessThanOrEqual(2);
  await expect(jump(page)).toHaveCount(0);
}

function updateAnswer(world: JourneyWorld, text: string) {
  world.cloud.changeSession('history-a', (doc) => {
    const turn = doc.getList('history').get(1);
    assert.ok(turn instanceof LoroMap);
    const items = turn.get('items');
    assert.ok(items instanceof LoroList);
    const item = items.get(1);
    assert.ok(item instanceof LoroMap);
    const content = item.get('text');
    assert.ok(content instanceof LoroText);
    content.update(text);
  });
}

When(
  'I select text and inspect a short conversation without leaving its latest content',
  async function (this: JourneyWorld) {
    this.cloud.changeSession('history-a', (doc) => {
      const turn = doc.getList('history').get(1);
      assert.ok(turn instanceof LoroMap);
      turn.set('finished', false);
      const items = turn.setContainer('items', new LoroList());
      const tool = items.insertContainer(0, new LoroMap());
      tool.set('type', 'tool_call');
      tool.set('toolCallId', 'scroll-inspection');
      tool.set('title', '检查阅读位置');
      tool.set('kind', 'read');
      tool.set('status', 'completed');
      tool.set('content', [{ type: 'terminal_output', output: '简短的检查结果。' }]);
      const item = items.insertContainer(1, new LoroMap());
      item.set('type', 'text');
      item.setContainer('text', new LoroText()).update('这是一段可以选中检查的简短回复。');
    });
    await ready(this);
    await selectFixtureConversation(this.page);
    const answer = this.page.getByText('这是一段可以选中检查的简短回复。', { exact: true });
    await expect(answer).toBeVisible();
    this.assertions = () =>
      this.evidence.check('short-inspection-does-not-offer-empty-jump', async () => {
        await answer.dblclick();
        await expect
          .poll(() => this.page.evaluate(() => window.getSelection()?.toString().length ?? 0))
          .toBeGreaterThan(0);
        await atBottom(this.page);
        const disclosure = transcript(this.page)
          .locator('button[aria-expanded]:not([aria-haspopup])')
          .first();
        await disclosure.click();
        await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        await atBottom(this.page);
        await disclosure.click();
        await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        await atBottom(this.page);
      });
  },
);

When(
  'I read upward during streamed output and return to the latest content after layout changes',
  async function (this: JourneyWorld) {
    updateAnswer(this, longAnswer);
    await expect(transcript(this.page)).toContainText('第 60 段', { timeout: 15000 });
    await jump(this.page).click();
    await atBottom(this.page);
    const before = await geometry(this.page);
    await transcript(this.page).hover({ position: { x: 40, y: 100 } });
    await this.page.mouse.wheel(0, -20);
    await this.evidence.check(
      'small-upward-scroll-releases-follow-without-layout-shift',
      async () => {
        await expect
          .poll(async () => (await geometry(this.page)).top)
          .toBeLessThan(before.top - 10);
        await expect(jump(this.page)).toBeVisible();
        expect((await geometry(this.page)).height).toBe(before.height);
      },
    );
    const reading = (await geometry(this.page)).top;
    updateAnswer(this, `${longAnswer}\n\n新输出保留阅读位置。`);
    await this.evidence.check('stream-preserves-reading-position', async () => {
      await expect(transcript(this.page)).toContainText('新输出保留阅读位置。', { timeout: 15000 });
      await expect
        .poll(async () => Math.abs((await geometry(this.page)).top - reading))
        .toBeLessThanOrEqual(2);
      await expect(jump(this.page)).toBeVisible();
    });
    await jump(this.page).click();
    await atBottom(this.page);
    await this.evidence.check('following-survives-composer-and-viewport-resize', async () => {
      const originalHeight = (await geometry(this.page)).height;
      await composer(this.page).fill('保留输入中的草稿。\n'.repeat(8));
      await expect
        .poll(async () => (await geometry(this.page)).height)
        .toBeLessThan(originalHeight);
      await atBottom(this.page);
      await this.page.setViewportSize({ width: 360, height: 640 });
      await atBottom(this.page);
      await composer(this.page).fill('');
      await this.page.setViewportSize({ width: 360, height: 780 });
      await atBottom(this.page);
    });
    updateAnswer(this, `${longAnswer}\n\n新输出保留阅读位置。\n\n回到最新后继续跟随。`);
    this.assertions = () =>
      this.evidence.check('explicit-jump-resumes-follow', async () => {
        await expect(transcript(this.page)).toContainText('回到最新后继续跟随。', {
          timeout: 15000,
        });
        await atBottom(this.page);
        expect(
          (await new AxeBuilder({ page: this.page }).withTags(['wcag2a', 'wcag2aa']).analyze())
            .violations,
        ).toEqual([]);
      });
  },
);

When(
  'I reload my reading position before its conversation finishes loading',
  async function (this: JourneyWorld) {
    await transcript(this.page).hover({ position: { x: 40, y: 100 } });
    await this.page.mouse.wheel(0, -240);
    await expect(jump(this.page)).toBeVisible();
    const reading = (await geometry(this.page)).top;
    const cdp = await this.context.newCDPSession(this.page);
    await cdp.send('Storage.clearDataForOrigin', {
      origin: 'http://127.0.0.1:4173',
      storageTypes: 'indexeddb',
    });
    await cdp.detach();
    this.cloud.holdConnection();
    await this.page.reload();
    await expect(this.page.getByRole('article', { name: 'Agent 消息', exact: true })).toHaveCount(
      0,
    );
    this.cloud.releaseConnection();
    await restored(this.page);
    this.assertions = () =>
      this.evidence.check('reload-restores-reading-position-after-hydration', async () => {
        await expect(transcript(this.page)).toContainText('回到最新后继续跟随。', {
          timeout: 15000,
        });
        await expect
          .poll(async () => Math.abs((await geometry(this.page)).top - reading))
          .toBeLessThanOrEqual(2);
        await expect(jump(this.page)).toBeVisible();
        updateAnswer(
          this,
          `${longAnswer}\n\n新输出保留阅读位置。\n\n回到最新后继续跟随。\n\n重新加载后的输出。`,
        );
        await expect(transcript(this.page)).toContainText('重新加载后的输出。', { timeout: 15000 });
        await expect
          .poll(async () => Math.abs((await geometry(this.page)).top - reading))
          .toBeLessThanOrEqual(2);
      });
  },
);
