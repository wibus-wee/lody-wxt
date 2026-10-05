import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import AxeBuilder from '@axe-core/playwright';
import { When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { JourneyWorld } from './world';
import { ready } from './world';

const requireSdk = createRequire(
  new URL('../../../packages/lody-sdk/package.json', import.meta.url),
);
const { LoroMap } = requireSdk(
  'loro-crdt',
) as typeof import('../../../packages/lody-sdk/node_modules/loro-crdt');
const attachment = {
  type: 'image',
  imageId: 'original-evidence',
  mimeType: 'image/png',
  sizeBytes: 128,
  storageSessionId: 'history-a',
};
const revised = 'Review the retained evidence again';
const queued = 'After this response, list the sources';
const guide = 'Focus the current response on the original evidence';
const sourceHistories = new WeakMap<JourneyWorld, unknown>();
const savedGuides = new WeakMap<JourneyWorld, unknown>();
const acceptedTransmissions = new WeakMap<JourneyWorld, string[]>();

async function advanced(world: JourneyWorld) {
  await ready(world);
  await world.page.goto('http://127.0.0.1:4173/#/workspace');
  await world.page.getByRole('button', { name: 'Historical conversation', exact: true }).click();
  await expect(world.page.getByRole('article', { name: 'Conversation history' })).toContainText(
    'Previously asked question',
  );
}
async function journal(world: JourneyWorld) {
  return world.page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('lody:turn:'));
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  });
}

When(
  'I edit my owned turn and fork its completed response in the workspace',
  async function (this: JourneyWorld) {
    this.cloud.changeSession('history-a', (doc) => {
      const user = doc.getList('history').get(0);
      assert.ok(user instanceof LoroMap);
      const input = user.get('inputConfig');
      assert.ok(input instanceof LoroMap);
      input.set('inputBlocks', [{ type: 'text', text: 'Previously asked question' }, attachment]);
    });
    await advanced(this);
    await this.page.getByRole('button', { name: 'Edit and resend', exact: true }).click();
    await this.page
      .getByRole('textbox', { name: 'Replacement message', exact: true })
      .fill(revised);
    await this.page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(this.page.getByRole('dialog')).toHaveCount(0);
    await this.evidence.check('edit-targets-owned-turn', async () => {
      await expect(this.page.getByRole('article', { name: 'Conversation history' })).toContainText(
        revised,
      );
      expect(this.cloud.editRequests).toHaveLength(1);
      const submitted = this.cloud.submittedTurn();
      expect(this.cloud.editRequests[0]).toMatchObject({
        expectedUserTurnId: 'previous-user-turn',
        requestedByUserId: 'user-a',
        requestId: submitted.requestId,
        replacementUserTurnId: submitted.requestId,
      });
      expect(submitted.inputConfig.inputBlocks).toEqual([
        { type: 'text', text: revised },
        attachment,
      ]);
      expect(submitted.inputConfig.prompt).toBe(revised);
      expect(this.cloud.historyTurnIds()).toEqual([submitted.requestId]);
    });
    this.cloud.beginReply('history-a');
    this.cloud.finishReply('history-a');
    await expect(
      this.page.getByRole('button', { name: 'Fork from this turn', exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    sourceHistories.set(this, this.cloud.document('history-a').getList('history').toJSON());
    await this.page.getByRole('button', { name: 'Fork from this turn', exact: true }).click();
    await this.page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(this.page.getByRole('dialog')).toHaveCount(0);
    this.assertions = () =>
      this.evidence.check('fork-keeps-source-context', async () => {
        expect(this.cloud.forkRequests).toHaveLength(1);
        const request = this.cloud.forkRequests[0]!;
        expect(request).toMatchObject({
          sourceSessionId: 'history-a',
          sourceTurnId: 'live-answer',
        });
        this.sessionId = request.targetSessionId;
        expect(this.cloud.document(this.sessionId).getList('history').toJSON()).toEqual(
          sourceHistories.get(this),
        );
        expect(this.cloud.document('history-a').getList('history').toJSON()).toEqual(
          sourceHistories.get(this),
        );
        await this.page
          .getByRole('textbox', { name: 'Title', exact: true })
          .fill('Disposable confirmed fork');
        await this.page.getByRole('button', { name: 'Rename', exact: true }).click();
        await expect(
          this.page.getByRole('heading', { name: 'Disposable confirmed fork', exact: true }),
        ).toBeVisible();
      });
  },
);

When(
  'I confirm deletion of only that fork and reload the workspace',
  async function (this: JourneyWorld) {
    this.cloud.completeDeleteCommands = true;
    await this.page.getByRole('button', { name: 'Delete conversation', exact: true }).click();
    expect(this.cloud.deleteRequests).toEqual([]);
    await expect(
      this.page.getByRole('button', { name: 'Disposable confirmed fork', exact: true }),
    ).toBeVisible();
    await this.page.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
    await this.evidence.check('delete-target-only', async () => {
      await expect(
        this.page.getByRole('button', { name: 'Disposable confirmed fork', exact: true }),
      ).toHaveCount(0, { timeout: 15000 });
      expect(this.cloud.deleteRequests).toEqual([this.sessionId]);
      expect(this.cloud.document('history-a').getList('history').toJSON()).toEqual(
        sourceHistories.get(this),
      );
      await expect(this.page.getByRole('article', { name: 'Conversation history' })).toContainText(
        'Select a conversation',
      );
    });
    await this.page.reload();
    await this.page.getByRole('button', { name: 'Historical conversation', exact: true }).click();
    this.assertions = () =>
      this.evidence.check('deletion-persists-after-reload', async () => {
        await expect(
          this.page.getByRole('button', { name: 'Disposable confirmed fork', exact: true }),
        ).toHaveCount(0);
        await expect(
          this.page.getByRole('article', { name: 'Conversation history' }),
        ).toContainText(revised);
        await expect(
          this.page.getByRole('article', { name: 'Conversation history' }),
        ).toContainText('网页分析完成');
        expect(this.cloud.document('history-a').getList('history').toJSON()).toEqual(
          sourceHistories.get(this),
        );
        expect(this.cloud.deleteRequests).toEqual([this.sessionId]);
        expect(
          await this.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        ).toBe(false);
        expect(
          (
            await new AxeBuilder({ page: this.page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
              .analyze()
          ).violations,
        ).toEqual([]);
      });
  },
);

When(
  'I queue a follow-up and lose confirmation of a steer to the active workspace turn',
  async function (this: JourneyWorld) {
    this.cloud.changeSession('history-a', (doc) => {
      const user = doc.getList('history').get(0);
      assert.ok(user instanceof LoroMap);
      const input = user.get('inputConfig');
      assert.ok(input instanceof LoroMap);
      input.set('mcpServerIds', ['research-stdio']);
    });
    await advanced(this);
    this.cloud.beginReply('history-a');
    await expect(
      this.page.getByRole('button', { name: 'Stop active turn', exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    await this.page.getByRole('textbox', { name: 'Message', exact: true }).fill(queued);
    await this.page.getByRole('button', { name: 'Queue', exact: true }).click();
    await this.evidence.check('queue-not-dispatched-immediately', async () => {
      await expect(this.page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
        '',
      );
      expect(this.cloud.queuedMessages()).toHaveLength(1);
      expect(this.cloud.queuedMessages()[0]).toMatchObject({
        task: queued,
        acpSessionConfig: { mcpServerIds: ['research-stdio'] },
      });
      expect(this.cloud.historyTurnIds()).toEqual([
        'previous-user-turn',
        'previous-assistant-turn',
        'live-answer',
      ]);
      expect(this.cloud.steerRequests).toHaveLength(0);
    });
    await this.page.evaluate(() =>
      localStorage.setItem('lody:reply:other-workspace', 'Unrelated workspace draft'),
    );
    this.cloud.loseNextSteerConfirmation = true;
    await this.page.getByRole('textbox', { name: 'Message', exact: true }).fill(guide);
    await this.page.getByRole('button', { name: 'Steer active turn', exact: true }).click();
    this.assertions = () =>
      this.evidence.check('steer-targets-active-turn', async () => {
        await expect(this.page.getByRole('alert')).toContainText('delivery is unconfirmed');
        expect(this.cloud.steerRequests).toHaveLength(1);
        this.requestId = this.cloud.submittedTurn().requestId;
        expect(this.cloud.steerRequests[0]).toMatchObject({
          sessionId: 'history-a',
          expectedTurnId: 'live-answer',
          userTurnId: this.requestId,
        });
        expect(this.cloud.submittedTurn().inputConfig.prompt).toBe(guide);
        expect(this.cloud.submittedTurn().inputConfig.mcpServerIds).toEqual(['research-stdio']);
        savedGuides.set(this, await journal(this));
        acceptedTransmissions.set(this, [...this.cloud.steerTransmissions]);
        expect(savedGuides.get(this)).toMatchObject({
          kind: 'guide',
          expectedTurnId: 'live-answer',
          input: { requestId: this.requestId },
        });
        await expect(this.page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
      });
  },
);

When(
  'I reload and reconcile the original steer without dispatching it again',
  async function (this: JourneyWorld) {
    await this.page.reload();
    await this.evidence.check('journal-survives-reload', async () => {
      await expect(this.page.getByRole('alert')).toContainText('Delivery remains unconfirmed');
      expect(await journal(this)).toEqual(savedGuides.get(this));
      await expect(this.page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
        guide,
      );
      await expect(
        this.page.getByRole('button', { name: 'Steer active turn', exact: true }),
      ).toBeDisabled();
      expect(this.cloud.steerRequests).toHaveLength(1);
    });
    this.cloud.confirmSteer('history-a', this.requestId);
    await expect(this.page.getByRole('article', { name: 'Conversation history' })).toContainText(
      'user · handled',
      { timeout: 15000 },
    );
    await this.page
      .getByRole('button', { name: 'Check delivery and refresh history', exact: true })
      .click();
    this.assertions = () =>
      this.evidence.check('recovery-does-not-redispatch', async () => {
        await expect(this.page.getByRole('alert')).toHaveCount(0);
        await expect(this.page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
          '',
        );
        await expect(this.page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
        expect(
          await this.page.evaluate(() =>
            Object.keys(localStorage).filter((key) => key.startsWith('lody:reply:')),
          ),
        ).toEqual(['lody:reply:other-workspace']);
        expect(
          await this.page.evaluate(() => localStorage.getItem('lody:reply:other-workspace')),
        ).toBe('Unrelated workspace draft');
        expect(await journal(this)).toBeNull();
        expect(this.cloud.steerTransmissions).toEqual(acceptedTransmissions.get(this));
        expect(this.cloud.steerRequests).toHaveLength(1);
        expect(this.cloud.historyTurnIds().filter((id) => id === this.requestId)).toHaveLength(1);
        expect(this.cloud.queuedMessages()).toHaveLength(1);
        expect(this.cloud.queuedMessages()[0]).toMatchObject({
          task: queued,
          acpSessionConfig: { mcpServerIds: ['research-stdio'] },
        });
        expect(this.cloud.reply('history-a').get('finished')).toBe(false);
        const nextGuide = 'Prioritize the key claim in this response';
        const newerDraft = 'A separate question I am still writing';
        this.cloud.loseNextSteerConfirmation = true;
        await this.page.getByRole('textbox', { name: 'Message', exact: true }).fill(nextGuide);
        await this.page.getByRole('button', { name: 'Steer active turn', exact: true }).click();
        await expect(this.page.getByRole('alert')).toContainText('delivery is unconfirmed');
        const nextId = this.cloud.submittedTurn().requestId;
        const transmissions = [...this.cloud.steerTransmissions];
        await this.page.getByRole('textbox', { name: 'Message', exact: true }).fill(newerDraft);
        await this.page.reload();
        await expect(this.page.getByRole('alert')).toContainText('Delivery remains unconfirmed');
        await expect(this.page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
          newerDraft,
        );
        this.cloud.confirmSteer('history-a', nextId);
        await expect(
          this.page
            .getByRole('article', { name: 'Conversation history' })
            .getByText('user · handled', { exact: true }),
        ).toHaveCount(2, { timeout: 15000 });
        await this.page
          .getByRole('button', { name: 'Check delivery and refresh history', exact: true })
          .click();
        await expect(this.page.getByRole('alert')).toHaveCount(0);
        await expect(this.page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
          newerDraft,
        );
        await expect(this.page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
        expect(await journal(this)).toBeNull();
        expect(this.cloud.steerTransmissions).toEqual(transmissions);
        expect(this.cloud.steerRequests).toHaveLength(2);
        await this.page.reload();
        await this.page
          .getByRole('button', { name: 'Historical conversation', exact: true })
          .click();
        await expect(this.page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
          newerDraft,
        );
      });
  },
);
