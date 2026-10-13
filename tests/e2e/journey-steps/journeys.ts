import assert from 'node:assert/strict';

import AxeBuilder from '@axe-core/playwright';
import { Then, When } from '@cucumber/cucumber';
import type { Page } from '@playwright/test';

import { journeyExpect as expect } from '../../../tools/assurance/expect';
import { armInteraction } from '../../../tools/assurance/interaction';
import { longCommand } from '../../fixtures/assistant-work';
import { RuntimeBoundary } from '../support/runtime-boundary';
import type { JourneyWorld } from './world';
import { ready, restored, selectFixtureConversation, submittedSession } from './world';

const completedWorkLabel = /^(已完成工作|已工作 )/;

type Segment = (world: JourneyWorld) => Promise<void>;
const segments: Record<string, Segment> = {};
const register = (name: string, segment: Segment) => {
  segments[name] = segment;
};
const composer = (page: Page) => page.getByRole('textbox', { name: '消息', exact: true });
const sendButton = (page: Page) => page.getByRole('button', { name: '发送消息', exact: true });
const userTurn = (page: Page, text: string) =>
  page.getByRole('article', { name: '你的消息', exact: true }).filter({ hasText: text });
const reply = (page: Page) => page.getByRole('article', { name: 'Agent 消息', exact: true }).last();
async function scope(page: Page) {
  const key = await page.evaluate(() =>
    Object.keys(localStorage).find(
      (key) => key.startsWith('lody:chat-draft:') && key.endsWith(':new'),
    ),
  );
  assert.ok(key);
  return key.slice('lody:chat-draft:'.length, -':new'.length);
}
async function sendExisting(world: JourneyWorld) {
  await ready(world);
  await selectFixtureConversation(world.page);
  await composer(world.page).fill(world.draft);
  await sendButton(world.page).click();
  await expect(userTurn(world.page, world.draft)).toHaveCount(1);
  world.sessionId = 'history-a';
  world.requestId = world.cloud.submittedTurn().requestId;
}

register('authorize, choose a workspace and write a question', async (world) => {
  await ready(world);
  await composer(world.page).fill(world.draft);
  world.assertions = () =>
    world.evidence.check('workspace-selected', async () => {
      const stored = await world.page.evaluate(() =>
        JSON.parse(localStorage.getItem('lody:account:session')!),
      );
      expect(stored.workspaceId).toBe('workspace-a');
      expect(stored.token.access_token).toBe('controlled-browser-token');
    });
});
register('navigate through settings, reload and return to my question', async (world) => {
  const loginCount = world.account.requests.filter((entry) =>
    entry.path.includes('/device/'),
  ).length;
  await world.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await world.page.reload();
  await world.page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await restored(world.page);
  world.assertions = async () => {
    await world.evidence.check('draft-restored', () =>
      expect(composer(world.page)).toHaveValue(world.draft),
    );
    await world.evidence.check('same-identity-revalidated', () => {
      expect(
        world.account.requests.filter((entry) => entry.path === '/api/auth/get-session').length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        world.account.requests.filter((entry) => entry.path.includes('/device/')),
      ).toHaveLength(loginCount);
    });
  };
});
register('reload my saved question while identity validation is unavailable', async (world) => {
  await ready(world);
  await composer(world.page).fill(world.draft);
  await world.context.route('https://backend.lody.ai/api/auth/get-session', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"controlled_unavailable"}',
    }),
  );
  await world.page.reload();
  world.assertions = () =>
    world.evidence.check('restore-failure-visible', async () => {
      await expect(world.page.getByRole('alert')).toContainText('无法验证账户');
      await expect(world.page.getByRole('button', { name: '重试登录验证' })).toBeEnabled();
      expect(
        await world.page.evaluate(() => localStorage.getItem('lody:account:session')),
      ).not.toBeNull();
      await expect(composer(world.page)).toHaveCount(0);
    });
});
register(
  'retry validation and resume the retained question without a device login',
  async (world) => {
    const devices = world.account.requests.filter((entry) =>
      entry.path.includes('/device/'),
    ).length;
    await world.context.unroute('https://backend.lody.ai/api/auth/get-session');
    await world.page.getByRole('button', { name: '重试登录验证' }).click();
    await restored(world.page);
    world.assertions = async () => {
      await world.evidence.check('retry-revalidates-without-device-login', () =>
        expect(
          world.account.requests.filter((entry) => entry.path.includes('/device/')),
        ).toHaveLength(devices),
      );
      await world.evidence.check('prior-draft-restored', () =>
        expect(composer(world.page)).toHaveValue(world.draft),
      );
    };
  },
);
register(
  'cancel authorization after the token request starts and release its late success',
  async (world) => {
    let release = () => {};
    let requested = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await world.context.route('https://backend.lody.ai/api/auth/device/token', async (route) => {
      requested = true;
      await gate;
      await route
        .fulfill({
          contentType: 'application/json',
          body: '{"access_token":"controlled-browser-token","token_type":"Bearer","expires_in":3600}',
        })
        .catch(() => {});
    });
    await world.page.goto('http://127.0.0.1:4173/#/account');
    await world.page.getByRole('button', { name: '登录 Lody', exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await world.page.getByRole('button', { name: '取消登录', exact: true }).click();
    release();
    world.assertions = async () => {
      await world.evidence.check('cancel-visible', () =>
        expect(world.page.getByRole('alert')).toContainText('cancelled'),
      );
      await world.evidence.check('late-token-rejected', async () => {
        await expect(
          world.page.getByRole('button', { name: '登录 Lody', exact: true }),
        ).toBeEnabled();
        expect(
          await world.page.evaluate(() => localStorage.getItem('lody:account:session')),
        ).toBeNull();
        expect(world.account.requests.some((entry) => entry.path === '/api/auth/get-session')).toBe(
          false,
        );
      });
    };
  },
);
register('authorize a fresh generation and send a usable question', async (world) => {
  await world.context.unroute('https://backend.lody.ai/api/auth/device/token');
  await ready(world);
  await composer(world.page).fill(world.draft);
  await sendButton(world.page).click();
  world.assertions = () =>
    world.evidence.check('fresh-login-usable', () =>
      expect(userTurn(world.page, world.draft)).toHaveCount(1),
    );
});
register('choose permission configuration and send my first question', async (world) => {
  await ready(world);
  await world.page.locator('[data-permission-trigger]').click();
  await world.page.getByRole('menuitemradio', { name: 'Read-only', exact: true }).click();
  await composer(world.page).fill(world.draft);
  const feedback = await armInteraction(world.page, sendButton(world.page), 'send-feedback', {
    selector: 'article[aria-label="你的消息"]',
    text: world.draft,
  });
  const response = await armInteraction(world.page, sendButton(world.page), 'first-response', {
    selector: 'article[aria-label="Agent 消息"] p',
    nonEmpty: true,
  });
  await sendButton(world.page).click();
  await expect(userTurn(world.page, world.draft)).toHaveCount(1);
  world.sessionId = submittedSession(world);
  const input = world.cloud.submittedTurn(world.sessionId);
  world.requestId = input.requestId;
  world.cloud.beginReply(world.sessionId);
  world.cloud.finishReply(world.sessionId);
  world.evidence.interactions.push(await feedback(), await response());
  world.assertions = async () => {
    await world.evidence.check('configuration-reaches-turn', () =>
      expect(input.inputConfig).toMatchObject({
        modelId: 'model-a',
        modeId: 'read-only',
        configOptionValues: { modeId: 'read-only' },
      }),
    );
    await world.evidence.check('first-response-visible', () =>
      expect(reply(world.page)).toContainText('网页分析完成'),
    );
  };
});
register('retain my session through settings and continue the same mounted chat', async (world) => {
  await world.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await world.page.getByRole('button', { name: '返回对话', exact: true }).click();
  await world.evidence.check('route-preserves-session', () =>
    expect(userTurn(world.page, world.draft)).toHaveCount(1),
  );
  await composer(world.page).fill('Continue this exact conversation');
  await sendButton(world.page).click();
  world.assertions = () =>
    world.evidence.check('continuation-on-same-session', async () => {
      await expect(userTurn(world.page, 'Continue this exact conversation')).toHaveCount(1);
      const history = world.cloud.document(world.sessionId).getList('history').toJSON();
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: world.requestId, role: 'user' }),
          expect.objectContaining({
            role: 'user',
            inputConfig: expect.objectContaining({ prompt: 'Continue this exact conversation' }),
          }),
        ]),
      );
    });
});
register('send a first question whose write succeeds but confirmation is lost', async (world) => {
  await ready(world);
  world.cloud.loseNextWriteConfirmation = true;
  await composer(world.page).fill(world.draft);
  await sendButton(world.page).click();
  world.assertions = () =>
    world.evidence.check('uncertainty-blocks-new-send', async () => {
      await expect(world.page.getByRole('alert')).toContainText('发送结果待确认', {
        timeout: 35_000,
      });
      await expect(sendButton(world.page)).toBeDisabled();
      world.sessionId = submittedSession(world);
      world.originalDelivery = world.cloud.submittedTurn(world.sessionId);
      world.requestId = world.originalDelivery.requestId;
    });
});
register(
  'reload, reconcile the original request and continue only after confirmation',
  async (world) => {
    await world.page.reload();
    await restored(world.page);
    await world.evidence.check('journal-and-draft-survive-reload', async () => {
      await expect(composer(world.page)).toHaveValue(world.draft);
      const journal = await world.page.evaluate(
        (key) => JSON.parse(localStorage.getItem(`lody:real-turn:${key}`)!),
        await scope(world.page),
      );
      expect(journal.input).toEqual(world.originalDelivery);
    });
    const trigger = world.page.getByRole('button', { name: '确认发送结果', exact: true });
    const confirmed = await armInteraction(world.page, trigger, 'recovery-confirmed', {
      selector: 'article[aria-label="你的消息"]',
      text: world.draft,
      absent: '[role="alert"]',
    });
    world.cloud.restoreWriteConfirmation();
    await trigger.click();
    world.evidence.interactions.push(await confirmed());
    await world.evidence.check('same-request-confirmed-once', async () => {
      await expect(world.page.getByRole('alert')).toHaveCount(0);
      await expect(userTurn(world.page, world.draft)).toHaveCount(1);
      expect(world.cloud.submittedTurn(world.sessionId)).toEqual(world.originalDelivery);
      expect(world.cloud.document(world.sessionId).getList('history').toJSON()).toEqual([
        expect.objectContaining({ id: world.requestId }),
      ]);
      expect(
        await world.page.evaluate(() =>
          Object.keys(localStorage).filter((key) => key.startsWith('lody:real-turn:')),
        ),
      ).toEqual([]);
    });
    world.cloud.beginReply(world.sessionId);
    world.cloud.finishReply(world.sessionId);
    await expect(reply(world.page)).toContainText('网页分析完成');
    await composer(world.page).fill('A new request after exact recovery');
    await sendButton(world.page).click();
    world.assertions = () =>
      world.evidence.check('new-turn-after-recovery', async () => {
        await expect(userTurn(world.page, 'A new request after exact recovery')).toHaveCount(1);
        // The visible user turn is optimistic; wait for the authoritative append too.
        await expect(async () => {
          expect(world.cloud.submittedTurn(world.sessionId).requestId).not.toBe(world.requestId);
        }).toPass({ timeout: 15_000 });
      });
  },
);
register('reload with an unreadable delivery record and an unsent question', async (world) => {
  await ready(world);
  await composer(world.page).fill(world.draft);
  await world.page.evaluate(
    (key) => localStorage.setItem(`lody:real-turn:${key}`, '{broken'),
    await scope(world.page),
  );
  await world.page.reload();
  world.assertions = () =>
    world.evidence.check('corruption-visible', async () => {
      await expect(world.page.getByRole('alert')).toBeVisible();
      await expect(sendButton(world.page)).toBeDisabled();
      await expect(composer(world.page)).toHaveValue(world.draft);
    });
});
register('visit settings and retry reading without replacing the corrupt record', async (world) => {
  await world.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await world.page.getByRole('button', { name: '返回对话', exact: true }).click();
  await world.page.getByRole('button', { name: '重新读取', exact: true }).click();
  world.assertions = async () => {
    await world.evidence.check('record-preserved', async () =>
      expect(
        await world.page.evaluate(
          (key) => localStorage.getItem(`lody:real-turn:${key}`),
          await scope(world.page),
        ),
      ).toBe('{broken'),
    );
    await world.evidence.check('no-new-request', () =>
      expect(
        world.cloud.traffic.filter(
          (entry) => entry.kind === 'append' && entry.stream.includes(':s:'),
        ),
      ).toEqual([]),
    );
  };
});
register('start streaming while a separate surface logs out this device', async (world) => {
  await ready(world);
  await composer(world.page).fill(world.draft);
  await selectFixtureConversation(world.page);
  await composer(world.page).fill('A turn before logout');
  await sendButton(world.page).click();
  await expect(userTurn(world.page, 'A turn before logout')).toHaveCount(1);
  world.cloud.beginReply('history-a');
  await expect(reply(world.page)).toContainText('正在分析网页');
  world.otherPage = await world.context.newPage();
  await world.otherPage.goto('http://127.0.0.1:4173/#/account');
  await world.otherPage.getByRole('button', { name: '退出此设备', exact: true }).click();
  world.assertions = () =>
    world.evidence.check('all-surfaces-revoke-access', async () => {
      await expect(composer(world.page)).toHaveCount(0);
      await expect(
        world.otherPage!.getByRole('button', { name: '登录 Lody', exact: true }),
      ).toBeEnabled();
    });
});
register('receive the old stream completion, reload and sign in again', async (world) => {
  world.cloud.finishReply('history-a');
  await world.evidence.check('late-stream-not-visible', () =>
    expect(world.page.getByRole('article', { name: 'Agent 消息', exact: true })).toHaveCount(0),
  );
  await world.page.reload();
  await world.evidence.check('reload-stays-signed-out', async () => {
    await expect(world.page.getByRole('button', { name: '登录 Lody', exact: true })).toBeEnabled();
    expect(
      await world.page.evaluate(() => localStorage.getItem('lody:account:session')),
    ).toBeNull();
  });
  await ready(world);
  world.assertions = () =>
    world.evidence.check('relogin-scopes-retained-draft', async () => {
      await expect(userTurn(world.page, 'A turn before logout')).toHaveCount(1);
      await world.page.getByRole('button', { name: '新建会话', exact: true }).click();
      await expect(composer(world.page)).toHaveValue(world.draft);
    });
});
register('send, inspect partial work and authorize its exact permission request', async (world) => {
  await sendExisting(world);
  world.cloud.beginReply('history-a', true);
  await expect(reply(world.page)).toContainText('正在分析网页');
  await world.page.getByRole('button', { name: '允许一次', exact: true }).click();
  world.assertions = () =>
    world.evidence.check('permission-exact-turn', async () => {
      await expect(world.page.getByRole('button', { name: '允许一次', exact: true })).toHaveCount(
        0,
      );
      expect(world.cloud.reply('history-a').toJSON()).toMatchObject({
        id: 'live-answer',
        items: [
          expect.anything(),
          expect.objectContaining({
            permissionRequest: expect.objectContaining({
              requestId: 'page-permission',
              outcome: { outcome: 'selected', optionId: 'allow_once' },
            }),
          }),
        ],
      });
    });
});
register(
  'stop the active turn, observe its terminal state and send a continuation',
  async (world) => {
    await composer(world.page).fill('Continue after stopping');
    const trigger = world.page.getByRole('button', { name: '停止生成', exact: true });
    const stopped = await armInteraction(world.page, trigger, 'stop-observed', {
      selector: 'button[aria-label="发送消息"]',
      enabled: true,
    });
    await trigger.click();
    world.evidence.interactions.push(await stopped());
    await world.evidence.check('partial-content-preserved', () =>
      expect(reply(world.page)).toContainText('正在分析网页'),
    );
    await world.evidence.check('stop-terminal-observed', async () => {
      await expect(reply(world.page)).toContainText('已停止 · 内容已保留', { timeout: 15_000 });
      expect(world.cloud.cancelRequests).toEqual([
        { sessionId: 'history-a', turnId: 'live-answer' },
      ]);
      expect(world.cloud.reply('history-a').toJSON()).toMatchObject({
        finished: true,
        status: 'canceled',
      });
    });
    await sendButton(world.page).click();
    world.assertions = () =>
      world.evidence.check('continuation-enabled-after-terminal', () =>
        expect(userTurn(world.page, 'Continue after stopping')).toHaveCount(1),
      );
  },
);
register('request a stop while its command response stream is denied', async (world) => {
  await sendExisting(world);
  world.cloud.beginReply('history-a');
  await expect(world.page.getByRole('button', { name: '停止生成', exact: true })).toBeEnabled();
  world.cloud.denyCommandResponses = true;
  await world.page.getByRole('button', { name: '停止生成', exact: true }).click();
  world.assertions = async () => {
    await world.evidence.check('stop-error-visible', () =>
      expect(world.page.getByRole('alert')).toContainText('forbidden'),
    );
    await world.evidence.check('no-fabricated-terminal-state', async () => {
      await expect(world.page.getByRole('button', { name: '停止生成', exact: true })).toBeEnabled();
      expect(world.cloud.cancelRequests).toEqual([]);
      expect(world.cloud.reply('history-a').toJSON()).toMatchObject({ finished: false });
    });
  };
});
register(
  'reread the actual active turn and stop only after the command boundary recovers',
  async (world) => {
    world.cloud.denyCommandResponses = false;
    await world.page.getByRole('button', { name: '重新读取', exact: true }).click();
    await world.page.getByRole('button', { name: '停止生成', exact: true }).click();
    world.assertions = () =>
      world.evidence.check('reread-reconciles-real-state', async () => {
        await expect(reply(world.page)).toContainText('已停止 · 内容已保留', { timeout: 15_000 });
        expect(world.cloud.cancelRequests).toHaveLength(1);
      });
  },
);
register('keep a question while changing theme and ambient policy', async (world) => {
  await ready(world);
  await composer(world.page).fill(world.draft);
  world.otherPage = await world.context.newPage();
  await world.otherPage.goto('http://127.0.0.1:4173/#/settings');
  await world.page.bringToFront();
  await world.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await world.page.getByRole('combobox', { name: '主题', exact: true }).click();
  const trigger = world.page.getByRole('option', { name: '深色', exact: true });
  const applied = await armInteraction(world.page, trigger, 'appearance-applied', {
    selector: 'main',
    attribute: { name: 'data-theme', value: 'dark' },
  });
  await trigger.click();
  world.evidence.interactions.push(await applied());
  await world.page.getByRole('switch', { name: '背景动态效果', exact: true }).click();
  world.assertions = () =>
    world.evidence.check('preferences-propagate', async () => {
      await expect(world.otherPage!.locator('main')).toHaveAttribute('data-theme', 'dark');
      await expect(world.otherPage!.locator('main')).toHaveAttribute('data-mood', 'outline');
      await expect(
        world.otherPage!.getByRole('switch', { name: '背景动态效果', exact: true }),
      ).toBeChecked();
    });
});
register('reload, return by keyboard and continue the draft with reduced motion', async (world) => {
  await world.page.reload();
  await world.page.getByRole('button', { name: 'Workspace', exact: true }).focus();
  await world.page.keyboard.press('Enter');
  await restored(world.page);
  world.assertions = async () => {
    await world.evidence.check('draft-survives-settings-and-reload', () =>
      expect(composer(world.page)).toHaveValue(world.draft),
    );
    await world.evidence.check('motion-policy-disables-shader', async () => {
      await expect(world.page.getByTestId('ambient')).toHaveCount(0);
      expect(
        await world.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
      ).toBe(true);
    });
    await world.evidence.check('keyboard-and-accessibility-usable', async () => {
      await expect(composer(world.page)).toBeFocused();
      const attachments = world.page.getByRole('button', { name: '附加上下文', exact: true });
      await expect(attachments).toBeEnabled();
      await expect(attachments).toHaveCSS('transition-duration', '0s');
      const result = await new AxeBuilder({ page: world.page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(result.violations).toEqual([]);
      await world.page.keyboard.press('Enter');
      await expect(userTurn(world.page, world.draft)).toHaveCount(1);
    });
  };
});
register('read a long streamed turn and inspect its grouped command details', async (world) => {
  await world.context.unroute('https://api.lody.ai/**');
  world.cloud = new RuntimeBoundary({ workHistory: { finished: false } });
  await world.cloud.install(world.context);
  await ready(world);
  await selectFixtureConversation(world.page);
  await composer(world.page).fill(world.draft);
  world.assertions = async () => {
    await world.evidence.check('commentary-tool-order', async () => {
      const item = reply(world.page);
      const first = await item
        .getByText('先检查仓库约定，再修改工作流。', { exact: true })
        .boundingBox();
      const group = await item
        .getByRole('button', { name: '12 条命令', exact: true })
        .boundingBox();
      const second = await item
        .getByText('仓库检查完成，接下来调整权限。', { exact: true })
        .boundingBox();
      assert.ok(first && group && second && first.y < group.y && group.y < second.y);
    });
    await world.evidence.check('details-inspectable', async () => {
      await reply(world.page).getByRole('button', { name: '12 条命令', exact: true }).click();
      await expect(
        reply(world.page).getByText('先核对现有约定，避免覆盖已有配置。', { exact: true }),
      ).toBeVisible();
      await reply(world.page)
        .getByRole('button', { name: longCommand.trim(), exact: true })
        .click();
      await expect(reply(world.page).locator('[data-tool-detail-sheet]').first()).toContainText(
        '第二行输出完整保留。',
      );
    });
  };
});
register(
  'observe the final answer, reload the same history and retain my next question',
  async (world) => {
    world.cloud.finishWorkHistory();
    await world.evidence.check('final-answer-folds-on-completion', async () => {
      await expect(reply(world.page).getByRole('button', { name: completedWorkLabel })).toBeVisible(
        { timeout: 15_000 },
      );
      await expect(
        reply(world.page).getByRole('heading', { name: '工作流已更新', exact: true }),
      ).toBeVisible();
      await expect(
        reply(world.page).getByText('下一步可以从 GitHub Actions 查看执行结果。', { exact: true }),
      ).toBeVisible();
      await expect(
        reply(world.page).getByRole('button', { name: '12 条命令', exact: true }),
      ).toHaveCount(0);
    });
    await world.page.reload();
    await restored(world.page);
    world.assertions = () =>
      world.evidence.check('reload-keeps-complete-answer', async () => {
        await expect(
          reply(world.page).getByRole('heading', { name: '工作流已更新', exact: true }),
        ).toBeVisible();
        await expect(composer(world.page)).toHaveValue(world.draft);
        const transcript = world.page.getByRole('region', { name: '消息记录', exact: true });
        expect(
          await transcript.evaluate((element) => element.scrollWidth > element.clientWidth),
        ).toBe(false);
        await sendButton(world.page).click();
        await expect(userTurn(world.page, world.draft)).toHaveCount(1);
      });
  },
);

register(
  'inspect partial command work, keep a next question and stop the real active turn',
  async (world) => {
    await world.context.unroute('https://api.lody.ai/**');
    world.cloud = new RuntimeBoundary({ workHistory: { finished: false } });
    await world.cloud.install(world.context);
    await ready(world);
    await selectFixtureConversation(world.page);
    await composer(world.page).fill(world.draft);
    await world.evidence.check('live-work-inspected', async () => {
      await reply(world.page).getByRole('button', { name: '12 条命令', exact: true }).click();
      await reply(world.page)
        .getByRole('button', { name: longCommand.trim(), exact: true })
        .click();
      await expect(reply(world.page).locator('[data-tool-detail-sheet]').first()).toContainText(
        '第二行输出完整保留。',
      );
    });
    await world.page.getByRole('button', { name: '停止生成', exact: true }).click();
    world.assertions = () =>
      world.evidence.check('terminal-keeps-partial-work', async () => {
        await expect(reply(world.page)).toContainText('已停止 · 内容已保留', { timeout: 15_000 });
        await expect(
          reply(world.page).getByRole('button', { name: completedWorkLabel }),
        ).toHaveCount(0);
        await expect(
          reply(world.page).getByRole('button', { name: '12 条命令', exact: true }),
        ).toBeVisible();
        await expect(
          reply(world.page).getByText('先核对现有约定，避免覆盖已有配置。', { exact: true }),
        ).toBeVisible();
        await expect(reply(world.page).locator('[data-tool-detail-sheet]').first()).toContainText(
          '第二行输出完整保留。',
        );
        expect(world.cloud.cancelRequests).toEqual([
          { sessionId: 'history-a', turnId: 'previous-assistant-turn' },
        ]);
      });
  },
);
register(
  'reload the stopped work, inspect its retained details and continue the next question',
  async (world) => {
    await world.page.reload();
    await restored(world.page);
    await world.evidence.check('reload-keeps-stopped-work', async () => {
      await expect(reply(world.page)).toContainText('已停止 · 内容已保留');
      await expect(composer(world.page)).toHaveValue(world.draft);
      await expect(reply(world.page).getByRole('button', { name: completedWorkLabel })).toHaveCount(
        0,
      );
      await reply(world.page).getByRole('button', { name: '12 条命令', exact: true }).click();
      await reply(world.page)
        .getByRole('button', { name: longCommand.trim(), exact: true })
        .click();
      await expect(reply(world.page).locator('[data-tool-detail-sheet]').first()).toContainText(
        '第二行输出完整保留。',
      );
      const transcript = world.page.getByRole('region', { name: '消息记录', exact: true });
      expect(
        await transcript.evaluate((element) => element.scrollWidth > element.clientWidth),
      ).toBe(false);
      expect(
        (
          await new AxeBuilder({ page: world.page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
    });
    await sendButton(world.page).click();
    world.assertions = () =>
      world.evidence.check('continuation-from-stopped-work', async () => {
        await expect(userTurn(world.page, world.draft)).toHaveCount(1);
        expect(world.cloud.submittedQuestions(world.draft)).toBe(1);
      });
  },
);

When('I follow {string}', async function (this: JourneyWorld, name: string) {
  const segment = segments[name];
  assert.ok(segment, `Unknown authored lifecycle segment: ${name}`);
  this.assertions = undefined;
  await segment(this);
});
Then('the product obligations for this segment hold', async function (this: JourneyWorld) {
  assert.ok(this.assertions, 'The segment must provide observable assertions');
  await this.assertions();
  this.assertions = undefined;
});
