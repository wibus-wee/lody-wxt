import assert from 'node:assert/strict';

import { After, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { JourneyWorld } from './world';
import { ready, reopen, restored, submittedSession } from './world';

const releases = new WeakMap<JourneyWorld, () => void>();
After(function (this: JourneyWorld) {
  releases.get(this)?.();
});

When(
  'the first conversation surface claims an in-flight delivery',
  async function (this: JourneyWorld) {
    await ready(this);
    await this.page.getByRole('textbox', { name: '消息', exact: true }).fill(this.draft);
    this.otherPage = await this.context.newPage();
    await this.otherPage.goto(this.page.url());
    await restored(this.otherPage);
    await expect(this.otherPage.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
      this.draft,
    );
    let held = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const match = 'https://api.lody.ai/**';
    await this.context.route(match, async (route) => {
      if (route.request().method() === 'POST' && !held) {
        held = true;
        await gate;
      }
      await route.fallback();
    });
    releases.set(this, release);
    await this.page.getByRole('button', { name: '发送消息', exact: true }).click();
    this.assertions = () =>
      this.evidence.check('one-surface-claims-delivery', async () => {
        await expect.poll(() => held).toBe(true);
        const journal = await this.page.evaluate(() => {
          const key = Object.keys(localStorage).find((key) => key.startsWith('lody:real-turn:'));
          return key ? JSON.parse(localStorage.getItem(key)!) : null;
        });
        expect(journal?.input.inputConfig.prompt).toBe(this.draft);
        this.requestId = journal.input.requestId;
        this.sessionId = journal.sessionId;
        const locks = await this.otherPage!.evaluate(() => navigator.locks.query());
        expect(locks.held?.some((lock) => lock.name?.startsWith('lody:real-create:'))).toBe(true);
      });
  },
);

When('the other surface tries to submit the same draft', async function (this: JourneyWorld) {
  assert.ok(this.otherPage);
  try {
    await this.otherPage.getByRole('button', { name: '发送消息', exact: true }).click();
    await this.evidence.check('other-surface-blocked', async () => {
      await expect(this.otherPage!.getByRole('alert')).toContainText('另一个窗口正在发送');
      await expect(this.otherPage!.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
        this.draft,
      );
      const locks = await this.otherPage!.evaluate(() => navigator.locks.query());
      expect(locks.pending?.filter((lock) => lock.name?.startsWith('lody:real-create:'))).toEqual(
        [],
      );
    });
  } finally {
    releases.get(this)?.();
  }
});

Then('both surfaces reconcile exactly one admitted turn', async function (this: JourneyWorld) {
  assert.ok(this.otherPage);
  await this.evidence.check('both-surfaces-observe-one-turn', async () => {
    const userTurn = this.page.getByRole('article', { name: '你的消息', exact: true });
    await expect(userTurn).toContainText(this.draft);
    expect(submittedSession(this)).toBe(this.sessionId);
    await this.otherPage!.getByRole('button', { name: '重新读取', exact: true }).click();
    await reopen(this.otherPage!, this.draft);
    await expect(
      this.otherPage!.getByRole('article', { name: '你的消息', exact: true }),
    ).toHaveCount(1);
    await expect(
      this.otherPage!.getByRole('article', { name: '你的消息', exact: true }),
    ).toContainText(this.draft);
    expect(this.cloud.historyTurnIds(this.sessionId)).toEqual([this.requestId]);
    expect(this.cloud.submittedTurn(this.sessionId).inputConfig.prompt).toBe(this.draft);
    const submittedIds = [
      ...new Set(
        this.cloud.traffic
          .filter((entry) => entry.kind === 'append' && entry.stream.startsWith('workspace-a:s:'))
          .map((entry) => entry.stream.slice('workspace-a:s:'.length)),
      ),
    ];
    expect(submittedIds).toEqual([this.sessionId]);
  });
});
