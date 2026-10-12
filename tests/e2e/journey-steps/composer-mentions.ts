import AxeBuilder from '@axe-core/playwright';
import { When } from '@cucumber/cucumber';
import type { Locator, Page } from '@playwright/test';

import { journeyExpect as expect } from '../../../tools/assurance/expect';
import type { JourneyWorld } from './world';
import { ready, restored, submittedSession } from './world';

const compactLabel = /compact/u;
const privateLabel = /desktop-private/u;
const sharedLabel = /team-summary/u;
const sessionLabel = /Historical conversation/u;
const skillLabel = /page-research/u;
const backLabel = /返回全部分类/u;
const unavailableLabel = /wrong-machine/u;
const structuredShortcutLabel = /scoped-review/u;
const composer = (page: Page) => page.getByRole('textbox', { name: '消息', exact: true });
const menu = (page: Page) => page.getByRole('listbox', { name: '提及与命令', exact: true });
// Deliver actual touch events across animation frames so the browser processes
// each move before the next one, then always release the active contact.
async function swipeTouch(page: Page, x: number, y: number, distance: number) {
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 0 }],
    });
    const steps = Math.ceil(Math.abs(distance) / 8);
    for (let step = 1; step <= steps; step++) {
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + (distance * step) / steps, id: 0 }],
      });
    }
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  } finally {
    try {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await touch.detach();
    }
  }
}

async function inspectMenu(world: JourneyWorld, name: string) {
  for (const width of [360, 400]) {
    await world.page.setViewportSize({ width, height: 780 });
    const bounds = await menu(world.page).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(
      await world.page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    expect(
      (
        await new AxeBuilder({ page: world.page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    await world.attach(await world.page.screenshot(), {
      mediaType: 'image/png',
      fileName: `${name}-${width}.png`,
    });
  }
  await world.page.setViewportSize({ width: 360, height: 780 });
}

When(
  'I search synchronized commands at the caret and cancel composition safely',
  async function (this: JourneyWorld) {
    await ready(this);
    const input = composer(this.page);
    await input.fill('/');
    await expect(menu(this.page)).toBeVisible();
    await this.evidence.check('merged-command-and-cloud-shortcut', async () => {
      await expect(menu(this.page).getByRole('option', { name: compactLabel })).toBeVisible();
      await expect(menu(this.page).getByRole('option', { name: privateLabel })).toBeVisible();
      await expect(menu(this.page).getByRole('option', { name: sharedLabel })).toBeVisible();
      await expect(menu(this.page)).not.toContainText('other-private');
      expect(
        this.cloud.shortcuts.traffic.some((entry) => entry.stream.includes('shortcut-index')),
      ).toBe(true);
      const shared = this.cloud.shortcuts.content('desktop-shared');
      this.cloud.shortcuts.publishFromDesktop(
        {
          ...shared,
          name: '团队实时更新',
          revision: 'desktop-shared-r2',
          updatedAt: 2,
        },
        'desktop-shared-r2-body',
      );
      await expect(menu(this.page).getByRole('option', { name: sharedLabel })).toContainText(
        '团队实时更新',
        // Authorization refreshes every 15s; allow storage and rendering after that response.
        { timeout: 20000 },
      );
      expect(
        this.cloud.shortcuts.requests.filter((request) =>
          request.operation.endsWith('listAccessibleDocuments'),
        ).length,
      ).toBeGreaterThanOrEqual(2);
      expect(this.cloud.shortcuts.active()).toContainEqual(
        expect.objectContaining({
          shortcutId: 'desktop-shared',
          bodyDocId: 'desktop-shared-r2-body',
          publication: expect.objectContaining({ revision: 'desktop-shared-r2' }),
        }),
      );
      await inspectMenu(this, 'slash-commands');
    });
    await input.fill('Keep /desktop-private tail');
    for (let offset = 0; offset < ' tail'.length; offset++) await input.press('ArrowLeft');
    await expect(menu(this.page).getByRole('option', { name: privateLabel })).toBeVisible();
    await input.press('Enter');
    await this.evidence.check('caret-replacement-no-auto-send', async () => {
      await expect(input).toHaveValue('Keep 检查这个页面，并给出下一步。 tail');
      await expect(this.page.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(
        0,
      );
      await expect(this.page.getByRole('heading', { name: '快捷指令与定时任务' })).toHaveCount(0);
    });
    await input.fill('/');
    await expect(menu(this.page)).toBeVisible();
    await input.press('Escape');
    await expect(menu(this.page)).toHaveCount(0);
    await expect(input).toHaveValue('/');
    await input.fill('$');
    await expect(menu(this.page)).toBeVisible();
    await input.dispatchEvent('compositionstart');
    await input.press('Enter');
    this.assertions = () =>
      this.evidence.check('escaped-or-ime-no-commit', async () => {
        await expect(menu(this.page)).toHaveCount(0);
        await expect(this.page.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(
          0,
        );
        await expect(input).not.toHaveValue('$page-research ');
        await input.dispatchEvent('compositionend');
      });
  },
);

When(
  'I retain selected skill and session mentions across reload and send one question',
  async function (this: JourneyWorld) {
    const input = composer(this.page);
    await input.fill('@');
    await expect(menu(this.page).getByRole('option', { name: '会话', exact: true })).toBeVisible();
    await inspectMenu(this, 'mention-categories');
    await input.fill('@session:Historical');
    await expect(menu(this.page).getByRole('option', { name: sessionLabel })).toBeVisible();
    await input.press('Tab');
    await expect(input).toHaveValue('@Historical-conversation ');
    await input.pressSequentially('$page');
    await expect(menu(this.page).getByRole('option', { name: skillLabel })).toBeVisible();
    await inspectMenu(this, 'skills');
    await input.press('Enter');
    await expect(input).toHaveValue('@Historical-conversation $page-research ');
    await this.page.reload();
    await restored(this.page);
    await this.evidence.check('mention-ranges-survive-reload', async () => {
      await expect(composer(this.page)).toHaveValue('@Historical-conversation $page-research ');
      const draft = await this.page.evaluate(() => {
        const key = Object.keys(localStorage).find(
          (item) => item.startsWith('lody:chat-draft:') && item.endsWith(':new'),
        );
        return key ? JSON.parse(localStorage.getItem(key)!) : null;
      });
      expect(draft.mentions).toEqual([
        expect.objectContaining({
          text: '@Historical-conversation',
          expansion: '[@Historical conversation](session://history-a)',
        }),
        expect.objectContaining({
          text: '$page-research',
          expansion: 'use /page-research [Skill Path](/controlled/skills/page-research/SKILL.md)',
        }),
      ]);
    });
    await this.evidence.check('session-mention-stable-id', async () => {
      await expect(this.page.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(
        0,
      );
      expect(this.cloud.document('history-a').getList('history').length).toBe(2);
      expect(
        await this.page.evaluate(() =>
          Object.entries(localStorage).filter(([key]) => key.startsWith('lody:chat-resume:')),
        ),
      ).toEqual([]);
    });
    this.draft = 'Inspect both sources';
    await composer(this.page).press('End');
    await composer(this.page).pressSequentially(this.draft);
    await this.page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(this.page.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(1);
    this.assertions = () =>
      this.evidence.check('frozen-skills-expand-in-single-prompt', async () => {
        const id = submittedSession(this);
        const submitted = this.cloud.submittedTurn(id);
        expect(submitted.inputConfig.prompt).toContain(
          '[@Historical conversation](session://history-a)',
        );
        expect(submitted.inputConfig.prompt).toContain(
          'use /page-research [Skill Path](/controlled/skills/page-research/SKILL.md)',
        );
        expect(submitted.inputConfig.prompt).toContain(this.draft);
        expect(this.cloud.historyTurnIds(id)).toEqual([submitted.requestId]);
        await expect(
          this.page.getByRole('button', { name: '附加上下文', exact: true }),
        ).toBeEnabled();
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

async function highlightCategory(page: Page, label: string) {
  const input = composer(page);
  const row = menu(page).getByRole('option', { name: label, exact: true });
  await expect(row).toBeVisible();
  await input.press('Home');
  for (let index = 0; index < (await menu(page).getByRole('option').count()); index++) {
    if ((await row.getAttribute('aria-selected')) === 'true') break;
    await input.press('ArrowDown');
  }
  await expect(row).toHaveAttribute('aria-selected', 'true');
}

async function optionBackground(option: Locator) {
  return option.evaluate((element) => {
    const color = getComputedStyle(element).backgroundColor;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is required to inspect the rendered highlight alpha.');
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return { color, alpha: context.getImageData(0, 0, 1, 1).data[3] };
  });
}

async function inspectKeyboardHighlight(world: JourneyWorld) {
  const input = composer(world.page);
  const options = menu(world.page).getByRole('option');
  const first = options.first();
  const second = options.nth(1);
  const highlights: string[] = [];
  await expect(world.page.locator('main')).toHaveAttribute('data-theme', 'system');
  try {
    for (const colorScheme of ['light', 'dark'] as const) {
      await world.page.emulateMedia({ colorScheme });
      await input.press('Home');
      await expect(first).toHaveAttribute('aria-selected', 'true');
      await expect.poll(async () => (await optionBackground(first)).alpha).toBeGreaterThan(0);
      const previousThemeHighlight = highlights.at(-1);
      if (previousThemeHighlight) {
        // The system theme provider applies the media change after emulateMedia resolves.
        await expect
          .poll(async () => (await optionBackground(first)).color)
          .not.toBe(previousThemeHighlight);
      }
      const highlight = await optionBackground(first);
      highlights.push(highlight.color);
      await expect.poll(async () => (await optionBackground(second)).alpha).toBe(0);
      expect((await optionBackground(second)).color).not.toBe(highlight.color);
      await input.press('ArrowDown');
      await expect(second).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => optionBackground(second)).toEqual(highlight);
      await expect.poll(async () => (await optionBackground(first)).alpha).toBe(0);
      await expect(input).toBeFocused();
      await world.attach(await world.page.screenshot(), {
        mediaType: 'image/png',
        fileName: `mention-keyboard-highlight-${colorScheme}.png`,
      });
      await input.press('ArrowUp');
      await expect(first).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => optionBackground(first)).toEqual(highlight);
      await expect.poll(async () => (await optionBackground(second)).alpha).toBe(0);
    }
    expect(highlights[0]).not.toBe(highlights[1]);
  } finally {
    await world.page.emulateMedia({ colorScheme: null });
  }
}

const templatePrompt = '请按 $page-research 检查 {{主题}}。';
const skillToken = '$page-research';
When(
  'I navigate the original mention categories by keyboard and touch',
  async function (this: JourneyWorld) {
    const base = this.cloud.shortcuts.content('desktop-private');
    this.cloud.shortcuts.publishFromDesktop(
      {
        ...base,
        id: 'scoped-review',
        name: '带技能的审阅',
        slug: 'scoped-review',
        prompt: templatePrompt,
        revision: 'scoped-review-r1',
        scope: { machineId: 'machine-a', providerKey: 'builtin:claude' },
        mentions: [
          {
            start: templatePrompt.indexOf(skillToken),
            end: templatePrompt.indexOf(skillToken) + skillToken.length,
            label: skillToken,
            target: {
              kind: 'skill',
              source: 'global',
              machineId: 'machine-a',
              path: '/controlled/skills/page-research/SKILL.md',
              compatibleProviders: ['builtin:claude'],
            },
          },
        ],
      },
      'scoped-review-body',
    );
    this.cloud.shortcuts.publishFromDesktop(
      {
        ...base,
        id: 'wrong-machine',
        name: '另一台机器的审阅',
        slug: 'wrong-machine',
        revision: 'wrong-machine-r1',
        scope: { machineId: 'another-machine' },
      },
      'wrong-machine-body',
    );
    for (let index = 0; index < 12; index++) {
      const id = `navigation-example-${index}`;
      this.cloud.shortcuts.publishFromDesktop(
        { ...base, id, name: `阅读草稿 ${index + 1}`, slug: id, revision: `${id}-r1` },
        `${id}-body`,
      );
    }
    await ready(this);
    const input = composer(this.page);
    await input.fill('Lead @');
    await this.evidence.check('bare-at-does-not-discover-sources', async () => {
      await expect(
        menu(this.page).getByRole('option', { name: '命令', exact: true }),
      ).toBeVisible();
      await expect(
        menu(this.page).getByRole('option', { name: '快捷指令', exact: true }),
      ).toBeVisible();
      expect(this.cloud.skillRequests).toHaveLength(0);
      expect(
        this.cloud.reads.filter((stream) => stream === 'workspace-a:s:history-a'),
      ).toHaveLength(0);
    });
    await this.evidence.check('directional-category-navigation-preserves-focus', async () => {
      const categories = menu(this.page).getByRole('option');
      await inspectKeyboardHighlight(this);
      await input.press('End');
      await expect(categories.last()).toHaveAttribute('aria-selected', 'true');
      await highlightCategory(this.page, '命令');
      await input.press('ArrowRight');
      await expect(input).toHaveValue('Lead @cmd:');
      await expect(menu(this.page).getByRole('option', { name: compactLabel })).toBeVisible();
      await expect(menu(this.page).getByRole('option', { name: privateLabel })).toHaveCount(0);
      await input.press('ArrowLeft');
      await expect(input).toHaveValue('Lead @');
      await expect(input).toBeFocused();
      await highlightCategory(this.page, '快捷指令');
      await input.press('Tab');
      await expect(input).toHaveValue('Lead @shortcut:');
      await expect(menu(this.page).getByRole('option', { name: privateLabel })).toBeVisible();
      await expect(menu(this.page).getByRole('option', { name: compactLabel })).toHaveCount(0);
      await input.press('Backspace');
      await expect(input).toHaveValue('Lead @');
      await expect(input).toBeFocused();
    });
    await this.evidence.check('pointer-back-and-touch-leaf-selection', async () => {
      await menu(this.page).getByRole('option', { name: '快捷指令', exact: true }).tap();
      await expect(menu(this.page).getByRole('option', { name: privateLabel })).toBeVisible();
      const scroller = this.page.locator('[data-mention-scroll]');
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollHeight > element.clientHeight))
        .toBe(true);
      const bounds = await scroller.boundingBox();
      expect(bounds).not.toBeNull();
      await swipeTouch(
        this.page,
        bounds!.x + bounds!.width / 2,
        bounds!.y + bounds!.height * 0.8,
        -Math.min(120, bounds!.height * 0.5),
      );
      await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await expect(input).toHaveValue('Lead @shortcut:');
      await swipeTouch(
        this.page,
        bounds!.x + bounds!.width / 2,
        bounds!.y + bounds!.height * 0.2,
        Math.min(120, bounds!.height * 0.5) + 24,
      );
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollTop))
        .toBeLessThanOrEqual(1);
      const back = this.page.getByRole('button', { name: '快捷指令，返回全部分类', exact: true });
      await expect(back).toBeInViewport();
      await back.tap();
      await menu(this.page).getByRole('option', { name: '会话', exact: true }).tap();
      await expect(input).toHaveValue('Lead @session:');
      await expect(menu(this.page).getByRole('option', { name: sessionLabel })).toBeVisible();
      await this.page.getByRole('button', { name: '会话，返回全部分类', exact: true }).tap();
      await expect(input).toHaveValue('Lead @');
      await expect(input).toBeFocused();
      await menu(this.page).getByRole('option', { name: '会话', exact: true }).tap();
      await menu(this.page).getByRole('option', { name: sessionLabel }).tap();
      await expect(input).toHaveValue('Lead @Historical-conversation ');
      await expect(input).toBeFocused();
      await expect(menu(this.page)).toHaveCount(0);
      expect(this.cloud.historyTurnIds('history-a')).toHaveLength(2);
    });
    this.assertions = () =>
      this.evidence.check('canonical-command-triggers-and-modified-keys', async () => {
        await input.fill('/');
        await expect(menu(this.page).getByRole('option', { name: privateLabel })).toBeVisible();
        await inspectMenu(this, 'upstream-long-slash');
        const scroller = this.page.getByRole('region', { name: '提及选项', exact: true });
        await scroller.focus();
        await scroller.press('End');
        await expect
          .poll(() => scroller.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(0);
        await scroller.press('Escape');
        await expect(menu(this.page)).toHaveCount(0);
        await expect(input).toBeFocused();
        await input.fill('@cmd:compact');
        await expect(menu(this.page).getByRole('option', { name: compactLabel })).toBeVisible();
        await input.press('Tab');
        await expect(input).toHaveValue('/compact ');
        await input.fill('、compact');
        await expect(menu(this.page).getByRole('option', { name: compactLabel })).toBeVisible();
        await expect(this.page.getByRole('button', { name: backLabel })).toHaveCount(0);
        await input.press('Enter');
        await expect(input).toHaveValue('/compact ');
        await input.fill('￥page');
        await expect(menu(this.page).getByRole('option', { name: skillLabel })).toBeVisible();
        await input.press('Tab');
        await expect(input).toHaveValue('$page-research ');
        await input.fill('@cmd:');
        await expect(menu(this.page)).toBeVisible();
        await input.press('Shift+Tab');
        await expect(menu(this.page)).toHaveCount(0);
        await expect(input).toHaveValue('@cmd:');
        await input.fill('');
        await input.fill('@cmd:');
        await expect(menu(this.page)).toBeVisible();
        await input.press('Shift+Enter');
        await expect(input).toHaveValue('@cmd:\n');
        await expect(this.page.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(
          0,
        );
        expect(
          this.cloud.traffic.filter(
            (row) => row.kind === 'append' && row.stream.startsWith('workspace-a:s:'),
          ),
        ).toHaveLength(0);
      });
  },
);

When(
  'I apply a scoped shortcut with structured mentions using the original editing rules',
  async function (this: JourneyWorld) {
    const input = composer(this.page);
    await input.fill('/wrong-machine');
    await this.evidence.check('unavailable-shortcut-cannot-commit', async () => {
      const unavailable = menu(this.page).getByRole('option', { name: unavailableLabel });
      await expect(unavailable).toHaveAttribute('aria-disabled', 'true');
      await expect(unavailable).toContainText('机器');
      // Dispatch through the row's real pointer handler; aria-disabled alone does not prevent clicks.
      await unavailable.dispatchEvent('click');
      await expect(input).toHaveValue('/wrong-machine');
      await input.press('Enter');
      await expect(input).toHaveValue('/wrong-machine');
    });
    await input.fill('Before /scoped-review After');
    for (let offset = 0; offset < ' After'.length; offset++) await input.press('ArrowLeft');
    await expect(
      menu(this.page).getByRole('option', { name: structuredShortcutLabel }),
    ).toBeVisible();
    await input.press('Enter');
    await this.evidence.check(
      'shortcut-inserts-structured-ranges-and-literal-parameters',
      async () => {
        await expect(input).toHaveValue(`Before ${templatePrompt} After`);
        await expect(this.page.getByRole('dialog')).toHaveCount(0);
        const draft = await this.page.evaluate(() => {
          const key = Object.keys(localStorage).find(
            (item) => item.startsWith('lody:chat-draft:') && item.endsWith(':new'),
          );
          return key ? JSON.parse(localStorage.getItem(key)!) : null;
        });
        expect(draft.mentions).toEqual([
          expect.objectContaining({
            text: skillToken,
            start: 'Before '.length + templatePrompt.indexOf(skillToken),
            expansion: 'use /page-research [Skill Path](/controlled/skills/page-research/SKILL.md)',
          }),
        ]);
        expect(this.cloud.skillRequests.length).toBeGreaterThan(0);
      },
    );
    await this.evidence.check('committed-range-caret-and-backspace-are-atomic', async () => {
      const start = 'Before '.length + templatePrompt.indexOf(skillToken);
      const click = await input.evaluate((element, start) => {
        if (!(element instanceof HTMLTextAreaElement))
          throw new Error('Composer must be a textarea');
        const style = getComputedStyle(element);
        const canvas = document.createElement('canvas');
        const measure = canvas.getContext('2d');
        if (!measure) throw new Error('Text measurement unavailable');
        measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        return {
          x:
            Number.parseFloat(style.paddingLeft) +
            measure.measureText(element.value.slice(0, start + 1)).width,
          y: Number.parseFloat(style.paddingTop) + Number.parseFloat(style.lineHeight) / 2,
        };
      }, start);
      // A real pointer click goes through React's selection plugin; dispatching a
      // synthetic `select` event after a DOM setter does not exercise that path.
      await input.click({ position: click });
      await expect
        .poll(() =>
          input.evaluate((element) => {
            if (!(element instanceof HTMLTextAreaElement))
              throw new Error('Composer must be a textarea');
            return element.selectionStart;
          }),
        )
        .toBe(start);
      await input.press('ArrowRight');
      await expect
        .poll(() =>
          input.evaluate((element) =>
            element instanceof HTMLTextAreaElement ? element.selectionStart : -1,
          ),
        )
        .toBe(start + skillToken.length);
      await input.press('Backspace');
      await expect(input).toHaveValue(
        `Before ${templatePrompt.replace(`${skillToken} `, '')} After`,
      );
    });
    await input.fill('');
    await input.fill('/scoped-review');
    await expect(
      menu(this.page).getByRole('option', { name: structuredShortcutLabel }),
    ).toBeVisible();
    await input.press('Enter');
    await expect(input).toHaveValue(`${templatePrompt} `);
    this.draft = '检查 {{主题}}。';
    await this.page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(this.page.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(1);
    this.assertions = () =>
      this.evidence.check('shortcut-application-sends-one-expanded-prompt', async () => {
        const id = submittedSession(this);
        const submitted = this.cloud.submittedTurn(id);
        expect(submitted.inputConfig.prompt).toContain(
          'use /page-research [Skill Path](/controlled/skills/page-research/SKILL.md)',
        );
        expect(submitted.inputConfig.prompt).toContain('{{主题}}');
        expect(submitted.inputConfig.prompt).not.toContain('/scoped-review');
        expect(this.cloud.historyTurnIds(id)).toEqual([submitted.requestId]);
      });
  },
);
