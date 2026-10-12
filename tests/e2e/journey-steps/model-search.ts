import { Given, Then, When } from '@cucumber/cucumber';

import { journeyExpect as expect } from '../../../tools/assurance/expect';
import { searchConfigModel } from '../support/model-search-journey';
import { RuntimeBoundary } from '../support/runtime-boundary';
import type { JourneyWorld } from './world';
import { ready, submittedSession } from './world';

Given(
  'an isolated product with an ACP model category and thirty models',
  async function (this: JourneyWorld) {
    this.cloud = new RuntimeBoundary({
      searchableModels: { id: 'vendor-model', category: 'model' },
      agent: { cliType: 'registry', agentType: 'custom-agent' },
    });
    await this.account.install(this.context);
    await this.cloud.install(this.context);
    await this.page.goto('http://127.0.0.1:4173');
  },
);
When('I search ACP models and recover an empty query', async function (this: JourneyWorld) {
  await ready(this);
  await searchConfigModel(this.page, this.evidence, async (name) => {
    await this.attach(await this.page.screenshot(), {
      mediaType: 'image/png',
      fileName: `${name}.png`,
    });
  });
});
Then('the searched model is selected without sending', async function (this: JourneyWorld) {
  await expect(this.page.getByRole('button', { name: '运行配置', exact: true })).toContainText(
    'Research model 29',
  );
  await expect(this.page.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(0);
});
When('I send with the searched model', async function (this: JourneyWorld) {
  await this.page.getByRole('textbox', { name: '消息', exact: true }).fill(this.draft);
  await this.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(this.page.getByRole('article', { name: '你的消息', exact: true })).toContainText(
    this.draft,
  );
  this.sessionId = submittedSession(this);
});
Then('the ACP selection reaches the authoritative turn', async function (this: JourneyWorld) {
  await this.evidence.check('searched-model-reaches-turn', () => {
    expect(this.cloud.submittedTurn(this.sessionId).inputConfig).toMatchObject({
      configOptionValues: { 'vendor-model': 'provider/model-29' },
    });
  });
});
