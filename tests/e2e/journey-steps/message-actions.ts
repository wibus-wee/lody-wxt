import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import AxeBuilder from '@axe-core/playwright';
import { When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { JourneyWorld } from './world';
import { ready, restored, selectFixtureConversation } from './world';

const requireSdk = createRequire(
  new URL('../../../packages/lody-sdk/package.json', import.meta.url),
);
const { LoroMap } = requireSdk(
  'loro-crdt',
) as typeof import('../../../packages/lody-sdk/node_modules/loro-crdt');
const pageSource = {
  id: 'historical-page',
  kind: 'page',
  title: 'Original research source',
  url: 'https://example.test/research',
  text: 'The original captured evidence.',
  trust: 'untrusted',
};
const revisedQuestion = 'Compare the original evidence carefully';

When(
  'I edit a historical question with its attached page in the compact conversation',
  async function (this: JourneyWorld) {
    this.cloud.changeSession('history-a', (doc) => {
      const user = doc.getList('history').get(0);
      assert.ok(user instanceof LoroMap);
      user.set('pageContexts', [pageSource]);
    });
    await ready(this);
    await selectFixtureConversation(this.page);
    const user = this.page.getByRole('article', { name: '你的消息', exact: true });
    await expect(user).toContainText(pageSource.title);
    await user.getByRole('button', { name: '消息操作', exact: true }).click();
    await this.page.getByRole('menuitem', { name: '编辑并重发…', exact: true }).click();
    await this.page.getByRole('textbox', { name: '修改消息', exact: true }).fill(revisedQuestion);
    await this.page.getByRole('button', { name: '重发', exact: true }).click();
    await expect(this.page.getByRole('dialog')).toHaveCount(0);
    await expect(user).toContainText(revisedQuestion);
    await expect(user).toContainText(pageSource.title);
    this.assertions = () =>
      this.evidence.check('edit-targets-exact-user-and-preserves-context', async () => {
        const turns = this.cloud.historyTurnIds('history-a');
        expect(turns).not.toContain('previous-user-turn');
        expect(turns).not.toContain('previous-assistant-turn');
        const submitted = this.cloud.submittedTurn('history-a');
        expect(this.cloud.editRequests).toHaveLength(1);
        expect(this.cloud.editRequests[0]).toMatchObject({
          sessionId: 'history-a',
          expectedUserTurnId: 'previous-user-turn',
          replacementUserTurnId: submitted.requestId,
          requestId: submitted.requestId,
        });
        this.requestId = submitted.requestId;
        expect(submitted.inputConfig.prompt).toContain(revisedQuestion);
        expect(submitted.inputConfig.prompt).toContain(JSON.stringify(pageSource));
        expect(submitted.inputConfig.modelId).toBe('model-a');
      });
  },
);

When(
  'I regenerate the edited question and fork its completed response across reload',
  async function (this: JourneyWorld) {
    // Routed SSE responses end after one batch; the Streams client enforces a 5s reconnect floor.
    // This deadline covers remote delivery, while local interaction assertions keep the default.
    this.cloud.beginReply('history-a');
    this.cloud.finishReply('history-a');
    const assistant = this.page.getByRole('article', { name: 'Agent 消息', exact: true }).last();
    await expect(assistant).toContainText('网页分析完成', { timeout: 15000 });
    await assistant.getByRole('button', { name: '消息操作', exact: true }).click();
    await this.page.getByRole('menuitem', { name: '重新生成', exact: true }).click();
    await expect(assistant).toHaveCount(0);
    await this.evidence.check('regenerate-reuses-edited-question-and-context', async () => {
      const submitted = this.cloud.submittedTurn('history-a');
      expect(this.cloud.editRequests).toHaveLength(2);
      expect(this.cloud.editRequests[1]).toMatchObject({
        sessionId: 'history-a',
        expectedUserTurnId: this.requestId,
        replacementUserTurnId: submitted.requestId,
        requestId: submitted.requestId,
      });
      expect(submitted.requestId).not.toBe(this.requestId);
      expect(submitted.inputConfig.prompt).toContain(revisedQuestion);
      expect(submitted.inputConfig.prompt).toContain(JSON.stringify(pageSource));
      this.requestId = submitted.requestId;
    });
    this.cloud.beginReply('history-a');
    this.cloud.finishReply('history-a');
    await expect(assistant).toContainText('网页分析完成', { timeout: 15000 });
    const original = this.cloud.document('history-a').getList('history').toJSON();
    await assistant.getByRole('button', { name: '消息操作', exact: true }).click();
    await this.page.getByRole('menuitem', { name: '从这里分叉', exact: true }).click();
    await expect
      .poll(
        () =>
          [
            ...new Set(
              this.cloud.reads.filter(
                (stream) =>
                  stream.startsWith('workspace-a:s:') && stream !== 'workspace-a:s:history-a',
              ),
            ),
          ].length,
        { timeout: 15000 },
      )
      .toBe(1);
    const target = this.cloud.reads
      .find(
        (stream) => stream.startsWith('workspace-a:s:') && stream !== 'workspace-a:s:history-a',
      )!
      .slice('workspace-a:s:'.length);
    await this.evidence.check('fork-leaves-source-unchanged', async () => {
      expect(this.cloud.forkRequests).toHaveLength(1);
      expect(this.cloud.forkRequests[0]).toMatchObject({
        sourceSessionId: 'history-a',
        sourceTurnId: 'live-answer',
        targetSessionId: target,
      });
      expect(this.cloud.document('history-a').getList('history').toJSON()).toEqual(original);
      expect(this.cloud.document(target).getList('history').toJSON()).toEqual(original);
    });
    const trafficBeforeReload = this.cloud.traffic.length;
    this.cloud.reads.length = 0;
    await this.page.reload();
    await restored(this.page);
    this.assertions = () =>
      this.evidence.check('fork-restores-copied-context-after-reload', async () => {
        await expect
          .poll(() =>
            this.page.evaluate(() =>
              Object.entries(sessionStorage)
                .filter(([key]) => key.startsWith('lody:chat-selection:'))
                .map(([, value]) => value),
            ),
          )
          .toEqual([target]);
        await expect
          .poll(
            () =>
              this.cloud.reads.includes(`workspace-a:s:${target}`) ||
              this.cloud.traffic
                .slice(trafficBeforeReload)
                .some(
                  (row) =>
                    row.stream === `workspace-a:s:${target}` &&
                    new Set(['read', 'sse']).has(row.kind),
                ),
          )
          .toBe(true);
        await expect(
          this.page.getByRole('article', { name: '你的消息', exact: true }),
        ).toContainText(revisedQuestion);
        await expect(
          this.page.getByRole('article', { name: '你的消息', exact: true }),
        ).toContainText(pageSource.title);
        expect(this.cloud.document('history-a').getList('history').toJSON()).toEqual(original);
        expect(
          (await new AxeBuilder({ page: this.page }).withTags(['wcag2a', 'wcag2aa']).analyze())
            .violations,
        ).toEqual([]);
      });
  },
);
