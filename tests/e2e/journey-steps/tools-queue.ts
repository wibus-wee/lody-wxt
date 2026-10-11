import { When } from '@cucumber/cucumber';

import { journeyExpect as expect } from '../../../tools/assurance/expect';
import type { JourneyWorld } from './world';
import { ready, restored, selectFixtureConversation } from './world';

const skillName = /Page research/;

When(
  'I select a real skill and connectors before explicitly sending',
  async function (this: JourneyWorld) {
    await ready(this);
    await selectFixtureConversation(this.page);
    this.sessionId = 'history-a';
    await this.page.getByRole('textbox', { name: '消息', exact: true }).fill(this.draft);
    await this.page.getByRole('button', { name: '选择工具' }).click();
    await this.page.getByRole('menuitem', { name: '选择技能…' }).click();
    await this.page.getByRole('button', { name: 'Page research', exact: true }).click();
    await this.evidence.check('skill-fills-draft-without-sending', async () => {
      await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
        new RegExp(this.draft),
      );
      await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
        skillName,
      );
      expect(this.cloud.skillRequests.length).toBeGreaterThan(0);
      expect(this.cloud.historyTurnIds()).toHaveLength(2);
    });
    await this.page.getByRole('button', { name: '选择工具' }).click();
    await this.page.getByRole('menuitem', { name: '工作区连接器…' }).click();
    await expect(
      this.page.getByRole('switch', { name: 'Unconfigured HTTP tools', exact: true }),
    ).toBeDisabled();
    await this.page.getByRole('switch', { name: 'Research tools', exact: true }).click();
    await this.page.getByRole('button', { name: '应用到本次消息', exact: true }).click();
    this.draft = await this.page.getByRole('textbox', { name: '消息', exact: true }).inputValue();
    await this.page.getByRole('button', { name: '发送消息', exact: true }).click();
    this.assertions = () =>
      this.evidence.check('connector-selection-reaches-single-turn', async () => {
        await expect.poll(() => this.cloud.historyTurnIds().length).toBe(3);
        expect(this.cloud.submittedTurn().inputConfig).toMatchObject({
          prompt: this.draft,
          mcpServerIds: ['research-stdio'],
        });
        expect(this.cloud.submittedTurn().inputConfig.inputBlocks).toEqual([
          { type: 'text', text: this.draft },
        ]);
      });
  },
);

When(
  'I queue a follow-up while the assistant runs and reload the sidebar',
  async function (this: JourneyWorld) {
    this.cloud.beginReply(this.sessionId);
    await expect(this.page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
    await this.page
      .getByRole('textbox', { name: '消息', exact: true })
      .fill('完成之后，请整理来源清单。');
    await this.page.getByRole('button', { name: '运行中发送方式', exact: true }).click();
    await this.page.getByRole('menuitem', { name: '完成当前回复后发送', exact: true }).click();
    await this.evidence.check('running-draft-enters-authoritative-queue', async () => {
      await expect.poll(() => this.cloud.queuedMessages().length).toBe(1);
      expect(this.cloud.queuedMessages()[0]).toMatchObject({ task: '完成之后，请整理来源清单。' });
      expect(this.cloud.historyTurnIds()).toHaveLength(4);
      await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('');
    });
    await this.page.reload();
    await restored(this.page);
    this.assertions = () =>
      this.evidence.check('reload-retains-queue-without-extra-turn', async () => {
        await this.page
          .getByRole('button', { name: '1 条消息等待当前任务完成', exact: true })
          .click();
        await expect(
          this.page.getByText('完成之后，请整理来源清单。', { exact: true }),
        ).toBeVisible();
        expect(this.cloud.queuedMessages()).toHaveLength(1);
        expect(this.cloud.historyTurnIds()).toHaveLength(4);
      });
  },
);
