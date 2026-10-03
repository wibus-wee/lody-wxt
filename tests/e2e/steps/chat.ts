import assert from 'node:assert/strict';

import AxeBuilder from '@axe-core/playwright';
import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { transcriptFixture, transcriptPrompt, transcriptReply } from '../../fixtures/transcript';
import type { WorkspaceWorld } from './workspace';
const removeContext = /移除 Lody/;
const modelMenuRow = /^模型 /;
const reasoningMenuRow = /^思考强度 /;

async function attachmentMenu(world: WorkspaceWorld, name: string) {
  await world.page.getByRole('button', { name: '附加上下文' }).click();
  await world.page.getByRole('menuitem', { name, exact: true }).click();
}
async function runMenu(world: WorkspaceWorld) {
  const menu = world.page.getByRole('menu', { name: '运行配置', exact: true });
  if (!(await menu.isVisible())) await world.page.getByRole('button', { name: '运行配置' }).click();
  return menu;
}
async function closeRunMenu(world: WorkspaceWorld) {
  for (let i = 0; i < 3 && (await world.page.getByRole('menu').count()); i++)
    await world.page.keyboard.press('Escape');
  await expect(world.page.getByRole('menu')).toHaveCount(0);
}
When(
  'I choose run model {string} using search {string}',
  async function (this: WorkspaceWorld, name: string, search: string) {
    const menu = await runMenu(this);
    await menu.getByRole('menuitem', { name: modelMenuRow }).click();
    const field = this.page.getByRole('textbox', { name: '搜索模型' });
    await expect(field).toBeVisible();
    await expect(this.page.getByRole('dialog').last()).toHaveCSS('opacity', '1');
    const accessibility = await new AxeBuilder({ page: this.page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    assert.deepEqual(accessibility.violations, [], JSON.stringify(accessibility.violations));
    await field.fill(search);
    await field.press('ArrowDown');
    const option = this.page.getByRole('menuitemradio', { name, exact: true });
    await expect(option).toBeVisible();
    await option.click();
    await expect(option).toBeChecked();
    const bounds = await option.boundingBox();
    assert.ok(
      bounds && bounds.x >= 0 && bounds.x + bounds.width <= this.page.viewportSize()!.width,
    );
    await closeRunMenu(this);
  },
);
When('I choose reasoning {string}', async function (this: WorkspaceWorld, name: string) {
  const menu = await runMenu(this);
  await menu.getByRole('menuitem', { name: reasoningMenuRow }).click();
  const option = this.page.getByRole('menuitemradio', { name, exact: true });
  await option.click();
  await expect(option).toBeChecked();
  await closeRunMenu(this);
});
When('I enable run mode {string}', async function (this: WorkspaceWorld, name: string) {
  const menu = await runMenu(this);
  const row = menu.getByRole('menuitemcheckbox', { name, exact: true });
  await row.click();
  await expect(row).toBeChecked();
});
Then(
  'the run configuration is {string} with reasoning {string}',
  async function (this: WorkspaceWorld, model: string, reasoning: string) {
    const menu = await runMenu(this);
    await expect(menu.getByRole('menuitem', { name: `模型 ${model}`, exact: true })).toBeVisible();
    await expect(
      menu.getByRole('menuitem', { name: `思考强度 ${reasoning}`, exact: true }),
    ).toBeVisible();
    await closeRunMenu(this);
  },
);
Then('Ultra reasoning is unavailable', async function (this: WorkspaceWorld) {
  const menu = await runMenu(this);
  await menu.getByRole('menuitem', { name: reasoningMenuRow }).click();
  await expect(this.page.getByRole('menuitemradio', { name: 'Ultra', exact: true })).toHaveCount(0);
  await closeRunMenu(this);
});
Then(
  'the accepted configuration is {string} with reasoning {string}',
  async function (this: WorkspaceWorld, modelId: string, reasoningEffort: string) {
    const config = await this.page.evaluate(() => {
      const sessions = JSON.parse(
        localStorage.getItem('lody:demo:workspace:history:v1') ?? '[]',
      ) as { messages: { role: string; inputConfig?: unknown }[] }[];
      return sessions[0]?.messages.findLast((item) => item.role === 'user')?.inputConfig;
    });
    assert.ok(config && typeof config === 'object');
    assert.deepEqual(
      {
        modelId: (config as Record<string, unknown>).modelId,
        reasoningEffort: (config as Record<string, unknown>).reasoningEffort,
      },
      { modelId, reasoningEffort },
    );
  },
);
Then(
  'the Agent identifies the demo configuration {string}',
  async function (this: WorkspaceWorld, config: string) {
    await expect(this.page.getByRole('article', { name: 'Agent 消息' }).last()).toContainText(
      config,
    );
  },
);
When('I create a Lody conversation', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(this.page.getByRole('combobox', { name: '机器', exact: true })).toHaveText(
    '演示机器 · 在线',
  );
  await this.page.getByRole('button', { name: '创建会话', exact: true }).click();
  await expect(this.page.getByRole('dialog')).toHaveCount(0);
});
When('I attach a demo page', async function (this: WorkspaceWorld) {
  await attachmentMenu(this, '附加演示页面');
});
When('I request the current page', async function (this: WorkspaceWorld) {
  await attachmentMenu(this, '附加当前页面');
});
When('I simulate a failed send', async function (this: WorkspaceWorld) {
  await attachmentMenu(this, '演示：下一次发送失败');
});
When('I send {string}', async function (this: WorkspaceWorld, text: string) {
  await this.page.getByRole('textbox', { name: '消息', exact: true }).fill(text);
  await this.page.getByRole('button', { name: '发送消息', exact: true }).click();
});
Then('I receive streamed text', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('article', { name: 'Agent 消息' })).toContainText('Lody 演示');
  await expect(this.page.getByRole('button', { name: '停止生成' })).toBeVisible();
});
When('I stop the Agent', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: '停止生成' }).click();
});
Then('the received text is retained', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('article', { name: 'Agent 消息' })).toContainText('已停止');
  await expect(this.page.getByRole('article', { name: 'Agent 消息' })).toContainText('Lody 演示');
});
Then('I see my message {string}', async function (this: WorkspaceWorld, text: string) {
  await expect(this.page.getByRole('article', { name: '你的消息' })).toContainText(text);
});
Then('I do not see the message {string}', async function (this: WorkspaceWorld, text: string) {
  await expect(this.page.getByRole('article').filter({ hasText: text })).toHaveCount(0);
});
Then(
  'sending fails and the draft is {string}',
  async function (this: WorkspaceWorld, text: string) {
    await expect(this.page.getByRole('alert')).toContainText('演示发送失败');
    await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(text);
  },
);
When('I retry sending', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: '重试发送' }).click();
});
When('I write a draft {string}', async function (this: WorkspaceWorld, text: string) {
  await this.page.getByRole('textbox', { name: '消息', exact: true }).fill(text);
});
Then('the draft remains {string}', async function (this: WorkspaceWorld, text: string) {
  await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(text);
});
Then('the Agent completes its reply', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('article', { name: 'Agent 消息' }).last()).toContainText(
    '没有连接真实账户',
  );
  await expect(this.page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
});
Then('there is one user message', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('article', { name: '你的消息' })).toHaveCount(1);
});
Then('the composer is empty', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('');
});
Then('there are no sent messages', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('article')).toHaveCount(0);
});
When('I switch to conversation {string}', async function (this: WorkspaceWorld, title: string) {
  await this.page.getByRole('button', { name: '会话列表', exact: true }).click();
  await this.page.getByRole('menuitem', { name: title, exact: true }).click();
});
Then('no context is attached', async function (this: WorkspaceWorld) {
  await expect(this.page.getByTestId('context-card')).toHaveCount(0);
});
Then('I see the attachment source', async function (this: WorkspaceWorld) {
  await expect(this.page.getByTestId('context-card')).toContainText('Lody · 浏览器工作区');
  await this.page.getByRole('button', { name: '查看资料 Lody · 浏览器工作区' }).click();
  const preview = this.page.getByRole('dialog', { name: 'Lody · 浏览器工作区' });
  await expect(preview.getByRole('link')).toHaveAttribute('href', 'https://github.com/LodyAI/lody');
  await expect(preview).toContainText('非可信资料');
  await this.page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
});
When('I remove the attachment', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: removeContext }).click();
});
Then('I see a page access error', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('alert')).toContainText('网页预览无法读取其他标签页');
});
When('I compose Chinese text', async function (this: WorkspaceWorld) {
  const input = this.page.getByRole('textbox', { name: '消息', exact: true });
  await input.fill('中文输入');
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  await input.dispatchEvent('compositionend');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('中文输入\n\n');
});
When('I send the composer with Enter', async function (this: WorkspaceWorld) {
  await this.page.getByRole('textbox', { name: '消息', exact: true }).press('Enter');
});
When('I send a long message', async function (this: WorkspaceWorld) {
  await this.page
    .getByRole('textbox', { name: '消息', exact: true })
    .fill('需要分析的资料\n'.repeat(100));
  await this.page.getByRole('button', { name: '发送消息' }).click();
  await expect(this.page.getByRole('button', { name: '停止生成' })).toBeVisible();
});
When('I expand the long user message', async function (this: WorkspaceWorld) {
  await this.page
    .getByRole('article', { name: '你的消息' })
    .getByRole('button', { name: '展开全部' })
    .click();
  await expect(this.page.getByRole('button', { name: '收起', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});
When('I load rich message history', async function (this: WorkspaceWorld) {
  await this.page.evaluate(
    (history) => localStorage.setItem('lody:demo:workspace:history:v1', JSON.stringify([history])),
    transcriptFixture(),
  );
  await this.page.reload();
  await expect(
    this.page
      .getByRole('article', { name: 'Agent 消息' })
      .getByRole('heading', { name: '检查结果' }),
  ).toBeVisible();
});
Then(
  'user messages use the Lody bubble and upper attachment layout',
  async function (this: WorkspaceWorld) {
    const user = this.page.getByRole('article', { name: '你的消息' });
    await expect(user.getByRole('button', { name: '展开全部' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(user.getByRole('button', { name: '移除 扩展消息资料' })).toHaveCount(0);
    const bubble = user.locator('[data-user-message-text]');
    await expect(bubble).toHaveCSS('font-size', '14px');
    await expect(bubble).toHaveCSS('line-height', '20px');
    const bounds = await bubble.boundingBox();
    const attachment = await user.getByTestId('context-card').boundingBox();
    assert.ok(
      bounds && attachment && bounds.height <= 160 && attachment.y + attachment.height <= bounds.y,
    );
    await expect(user.locator('[data-user-message-text]')).not.toContainText('第 14 项');
  },
);
Then('the complete user prompt is visible', async function (this: WorkspaceWorld) {
  await expect(this.page.locator('[data-user-message-text]')).toHaveText(transcriptPrompt);
});
Then('the reply uses the Lody content rail', async function (this: WorkspaceWorld) {
  const reply = this.page.getByRole('article', { name: 'Agent 消息' });
  await expect(reply.getByText('Lody Agent', { exact: true })).toHaveCount(0);
  const prose = reply.locator('[data-message-prose]').first();
  await expect(prose).toHaveCSS('font-size', '14px');
  await expect(prose).toHaveCSS('line-height', '20px');
  const source = await prose.boundingBox();
  const header = await reply.getByRole('button', { name: '已工作 12 秒' }).boundingBox();
  assert.ok(source && header && Math.abs(source.x - header.x) <= 4);
  await expect(reply.getByRole('table')).toHaveCount(1);
  await expect(reply.locator('ol')).toHaveAttribute('start', '7');
  await expect(
    reply.locator('[data-streamdown="code-block-body"]').first().locator('code span[style]'),
  ).not.toHaveCount(0);
});
When('I expand the completed tool work', async function (this: WorkspaceWorld) {
  const reply = this.page.getByRole('article', { name: 'Agent 消息' });
  await expect(reply.getByRole('button', { name: '读取源码（演示）' })).toHaveCount(0);
  await reply.getByRole('button', { name: '已工作 12 秒' }).click();
  await reply.getByRole('button', { name: '读取源码（演示）' }).click();
});
Then('tool details use a single aligned sheet', async function (this: WorkspaceWorld) {
  const sheet = this.page.locator('[data-tool-detail-sheet]').filter({ visible: true });
  await expect(sheet).toHaveCount(1);
  await expect(sheet).toContainText('rg -n "MessageView" src');
  await expect(sheet).toContainText('src/features/chat/MessageView.tsx');
  const sheetBounds = await sheet.boundingBox();
  const prose = await this.page.locator('[data-message-prose]').first().boundingBox();
  assert.ok(sheetBounds && prose && Math.abs(sheetBounds.x - prose.x) <= 4);
});
When('I wrap the reply code', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: '代码自动换行' }).first().click();
});
Then('code wraps without widening the transcript', async function (this: WorkspaceWorld) {
  const fence = this.page.locator('[data-streamdown="code-block"]').first();
  await expect(fence.getByRole('button', { name: '代码自动换行' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(fence.locator('pre')).toHaveCSS('white-space', 'pre-wrap');
  const overflow = await this.page
    .getByRole('region', { name: '消息记录' })
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  assert.equal(overflow, false);
});
When('I preview the Markdown fence', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: '预览 Markdown' }).click();
});
Then('the Markdown fence renders its preview', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('heading', { name: '预览标题' })).toBeVisible();
  await expect(this.page.getByRole('button', { name: '隐藏预览' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
When('I inspect the accepted turn configuration', async function (this: WorkspaceWorld) {
  const reply = this.page.getByRole('article', { name: 'Agent 消息' });
  await reply.hover();
  await reply.getByRole('button', { name: '本轮配置' }).click();
});
Then(
  'the turn configuration is recorded independently of the draft',
  async function (this: WorkspaceWorld) {
    const dialog = this.page.getByRole('dialog', { name: '本轮配置' });
    await expect(dialog).toContainText('6 Astra');
    await expect(dialog).toContainText('Ultra');
    await expect(dialog).toContainText('Read-only');
  },
);
When('I copy the reply and its code', async function (this: WorkspaceWorld) {
  await this.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const reply = this.page.getByRole('article', { name: 'Agent 消息' });
  await reply.hover();
  const copy = reply.getByRole('button', { name: '复制消息', exact: true });
  await copy.click();
  await expect(copy).toHaveAttribute('data-copied', 'true');
  assert.equal(await this.page.evaluate(() => navigator.clipboard.readText()), transcriptReply);
  const fence = reply.locator('[data-streamdown="code-block"]').first();
  await fence.getByRole('button', { name: '复制代码' }).click();
  const code = await fence.locator('pre').textContent();
  assert.equal(await this.page.evaluate(() => navigator.clipboard.readText()), code);
});
Then('copy feedback resets without changing the transcript', async function (this: WorkspaceWorld) {
  await expect(
    this.page
      .getByRole('article', { name: 'Agent 消息' })
      .getByRole('button', { name: '复制消息', exact: true }),
  ).not.toHaveAttribute('data-copied', 'true');
  const text = await this.page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('lody:demo:workspace:history:v1') ?? '[]')[0]?.messages[1]
        ?.text,
  );
  assert.equal(text, transcriptReply);
});
When('I scroll up during generation', async function (this: WorkspaceWorld) {
  await this.page.getByRole('region', { name: '消息记录' }).evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
});
Then('I can return to the latest message', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('button', { name: '回到最新' })).toBeVisible();
  await this.page.getByRole('button', { name: '回到最新' }).click();
  await expect(this.page.getByRole('button', { name: '回到最新' })).toHaveCount(0);
});
Then('unsafe Markdown is inert', async function (this: WorkspaceWorld) {
  await expect(this.page.locator('article script')).toHaveCount(0);
  await expect(this.page.locator('article a[href^="javascript:"]')).toHaveCount(0);
});
When('I enable GitHub project matching', async function (this: WorkspaceWorld) {
  await this.page.getByRole('link', { name: 'Settings', exact: true }).click();
  await this.page.getByRole('switch', { name: '匹配 GitHub 会话项目' }).click();
  await expect(this.page.getByRole('switch', { name: '匹配 GitHub 会话项目' })).toBeChecked();
  await this.page.getByRole('link', { name: 'Workspace', exact: true }).click();
});
Then('my execution target includes {string}', async function (this: WorkspaceWorld, repo: string) {
  await this.page.getByRole('button', { name: '网页资料说明' }).click();
  await expect(this.page.getByRole('dialog', { name: '网页资料只读' })).toContainText(repo);
  await this.page.keyboard.press('Escape');
});
async function mode(world: WorkspaceWorld, label: string) {
  await world.page.getByRole('link', { name: 'Settings', exact: true }).click();
  await world.page.getByRole('combobox', { name: '连接模式' }).click();
  await world.page.getByRole('option', { name: label, exact: true }).click();
  await expect(world.page.getByRole('combobox', { name: '连接模式' })).toHaveText(label);
  await world.page.getByRole('link', { name: 'Workspace', exact: true }).click();
}
When('I select real Lody mode', async function (this: WorkspaceWorld) {
  await mode(this, '真实 Lody（待集成）');
});
When('I select demonstration mode', async function (this: WorkspaceWorld) {
  await mode(this, '演示模式');
});
Then('I see the real connection blocker', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('alert')).toContainText('真实连接不可用');
  await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toBeDisabled();
});
When('I use a narrow sidebar', async function (this: WorkspaceWorld) {
  await this.page.setViewportSize({ width: 360, height: 740 });
});
When('I choose the task suggestion {string}', async function (this: WorkspaceWorld, label: string) {
  await attachmentMenu(this, label);
  await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toBeFocused();
});
Then('the chat composer stays inside the viewport', async function (this: WorkspaceWorld) {
  const composer = this.page.getByTestId('composer');
  await expect(composer).toBeVisible();
  const box = await composer.boundingBox();
  const viewport = this.page.viewportSize();
  assert.ok(box && viewport);
  assert.ok(box.x >= 0 && box.x + box.width <= viewport.width);
  assert.ok(box.y + box.height <= viewport.height && box.y + box.height >= viewport.height - 80);
  await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  await expect(composer.getByRole('button', { name: '附加上下文' })).toBeVisible();
  await expect(composer.getByRole('button', { name: '发送消息' })).toBeVisible();
});
When('I choose theme {string}', async function (this: WorkspaceWorld, theme: string) {
  await this.page.getByRole('link', { name: 'Settings', exact: true }).click();
  await this.page.getByRole('combobox', { name: 'Theme', exact: true }).click();
  await this.page.getByRole('option', { name: theme, exact: true }).click();
  await expect(this.page.locator('main')).toHaveAttribute('data-theme', theme);
  await this.page.keyboard.press('Escape');
  await expect(this.page.getByRole('listbox')).toHaveCount(0);
  await this.page.getByRole('link', { name: 'Workspace', exact: true }).click();
});
Then('the page uses theme {string}', async function (this: WorkspaceWorld, theme: string) {
  await expect(this.page.locator('main')).toHaveAttribute('data-theme', theme);
});
Then('keyboard focus is visible', async function (this: WorkspaceWorld) {
  await this.page.keyboard.press('Tab');
  assert.ok(
    await this.page.evaluate(() => {
      const node = document.activeElement;
      if (!node) return false;
      const style = getComputedStyle(node);
      return (
        node.matches(':focus-visible') &&
        (style.outlineStyle !== 'none' || style.boxShadow !== 'none')
      );
    }),
  );
});
Then('there is no horizontal overflow', async function (this: WorkspaceWorld) {
  assert.ok(await this.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});
Then('the composer matches Lody resting geometry', async function (this: WorkspaceWorld) {
  const frame = this.page.getByTestId('composer');
  await expect(frame).toHaveCSS('border-top-width', '1px');
  await expect(frame).toHaveCSS('border-top-style', 'solid');
  await expect(frame).toHaveCSS('border-radius', '12px');
  await expect(frame).toHaveCSS('padding', '6px 8px');
  const prompt = frame.getByRole('textbox', { name: '消息', exact: true });
  await expect(prompt).toHaveCSS('min-height', '48px');
  await expect(prompt).toHaveCSS('padding', '0px 4px');
  await expect(prompt).toHaveCSS('font-size', '14px');
  const frameBox = await frame.boundingBox();
  assert.equal(frameBox?.height, 96);
  const controls = ['附加上下文', '运行配置', '权限：Auto review', '发送消息'];
  const boxes = await Promise.all(
    controls.map((name) => frame.getByRole('button', { name, exact: true }).boundingBox()),
  );
  for (const box of boxes) {
    assert.ok(box && boxes[0]);
    assert.equal(box.height, 28);
    assert.equal(box.y, boxes[0].y);
  }
  const agentClip = frame.getByRole('button', { name: '运行配置' }).locator('clipPath rect');
  await expect(agentClip).toHaveAttribute('width', '24');
  await expect(agentClip).toHaveAttribute('height', '24');
});
When('I inspect the composer configuration', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: '运行配置' }).click();
  const menu = this.page.getByRole('menu', { name: '运行配置' });
  await expect(menu.getByRole('menuitem', { name: 'Agent Codex' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '模型 6.1 Sol' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '思考强度 Medium' })).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Plan' })).not.toBeChecked();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Fast' })).not.toBeChecked();
});
When('I close the composer configuration', async function (this: WorkspaceWorld) {
  await this.page.keyboard.press('Escape');
  await expect(this.page.getByRole('menu')).toHaveCount(0);
});
When('I inspect the context permission', async function (this: WorkspaceWorld) {
  await this.page.getByRole('button', { name: '网页资料说明' }).click();
  const permission = this.page.getByRole('dialog', { name: '网页资料只读' });
  await expect(permission).toContainText('网页内容不授予 Agent 工具权限');
  await expect(permission).toHaveCSS('opacity', '1');
});
When('I inspect the Agent permission menu', async function (this: WorkspaceWorld) {
  await this.page.locator('[data-permission-trigger]').click();
  const menu = this.page.getByRole('menu');
  await expect(menu).toHaveCSS('opacity', '1');
  for (const name of ['Read-only', 'Agent', 'Auto review', 'Full access'])
    await expect(menu.getByRole('menuitemradio', { name, exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: 'Auto review', exact: true })).toBeChecked();
});
When('I choose Agent permission {string}', async function (this: WorkspaceWorld, name: string) {
  await this.page.locator('[data-permission-trigger]').click();
  await this.page.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(this.page.getByRole('menu')).toHaveCount(0);
  await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toBeFocused();
  await expect(this.page.locator('[data-permission-trigger]')).toHaveAttribute(
    'title',
    `权限：${name}`,
  );
});
Then('the Agent permission remains {string}', async function (this: WorkspaceWorld, name: string) {
  await expect(this.page.getByRole('button', { name: `权限：${name}`, exact: true })).toBeVisible();
  await this.page.locator('[data-permission-trigger]').click();
  await expect(this.page.getByRole('menuitemradio', { name, exact: true })).toBeChecked();
  await this.page.keyboard.press('Escape');
  await expect(this.page.getByRole('menu')).toHaveCount(0);
});
Then(
  'the accepted permission mode is {string}',
  async function (this: WorkspaceWorld, modeId: string) {
    const accepted = await this.page.evaluate(() => {
      const sessions = JSON.parse(
        localStorage.getItem('lody:demo:workspace:history:v1') ?? '[]',
      ) as {
        messages: { role: string; inputConfig?: { modeId?: string } }[];
      }[];
      return sessions[0]?.messages.findLast((message) => message.role === 'user')?.inputConfig
        ?.modeId;
    });
    assert.equal(accepted, modeId);
  },
);
When('I close the context permission', async function (this: WorkspaceWorld) {
  await this.page.keyboard.press('Escape');
  await expect(this.page.getByRole('dialog')).toHaveCount(0);
});
When('I focus the composer frame', async function (this: WorkspaceWorld) {
  await this.page.getByTestId('composer').click({ position: { x: 6, y: 4 } });
});
Then('the message input has focus', async function (this: WorkspaceWorld) {
  await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toBeFocused();
});
Then('attachment tiles are inside the composer', async function (this: WorkspaceWorld) {
  const frame = this.page.getByTestId('composer');
  const tile = frame.getByTestId('context-card');
  await expect(tile).toHaveCount(1);
  const bounds = await frame.boundingBox();
  const attachment = await tile.boundingBox();
  const prompt = await frame.getByRole('textbox', { name: '消息', exact: true }).boundingBox();
  assert.ok(bounds && attachment && prompt);
  assert.equal(attachment.width, 80);
  assert.equal(attachment.height, 80);
  assert.ok(attachment.y > bounds.y && attachment.y + attachment.height <= prompt.y);
  await expect(tile.getByRole('button', { name: removeContext })).toHaveCSS('height', '20px');
});
When('I expand the composer with a long draft', async function (this: WorkspaceWorld) {
  await this.page
    .getByRole('textbox', { name: '消息', exact: true })
    .fill('需要整理的资料\n'.repeat(60));
});
Then('the draft input scrolls within its height limit', async function (this: WorkspaceWorld) {
  const prompt = this.page.getByRole('textbox', { name: '消息', exact: true });
  const bounds = await prompt.boundingBox();
  assert.equal(bounds?.height, 264);
  assert.ok(await prompt.evaluate((node) => node.scrollHeight > node.clientHeight));
  await expect(this.page.getByRole('article')).toHaveCount(0);
});
