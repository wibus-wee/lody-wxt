import { When } from '@cucumber/cucumber';

import { journeyExpect as expect } from '../../../tools/assurance/expect';
import type { JourneyWorld } from './world';
import { ready, restored, submittedSession } from './world';

const preference = '先说明具体结论，再列出可以验证的依据。';
When(
  'I author and enable a personal preference before sending',
  async function (this: JourneyWorld) {
    await ready(this);
    await this.page.getByRole('textbox', { name: '消息', exact: true }).fill(this.draft);
    await this.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await this.page.getByRole('button', { name: '对话偏好 回复指令与背景' }).click();
    await this.evidence.check('preference-off-by-default', () =>
      expect(this.page.getByRole('switch', { name: '在新消息中使用' })).not.toBeChecked(),
    );
    await this.page.getByRole('textbox', { name: '回复偏好与背景' }).fill(preference);
    const back = this.page.getByRole('button', { name: '返回设置', exact: true });
    if (await back.isVisible()) await back.click();
    await this.page.getByRole('button', { name: '隐私与数据 浏览器访问与附件草稿' }).click();
    await expect(this.page.getByRole('heading', { name: '隐私与数据', exact: true })).toBeVisible();
    if (await back.isVisible()) await back.click();
    await this.page.getByRole('button', { name: '对话偏好 回复指令与背景' }).click();
    await expect(this.page.getByRole('textbox', { name: '回复偏好与背景' })).toHaveValue(
      preference,
    );
    await this.page.getByRole('button', { name: '保存偏好', exact: true }).click();
    await expect(this.page.getByText('个人偏好已保存。', { exact: true })).toBeVisible();
    await this.page.getByRole('switch', { name: '在新消息中使用' }).click();
    await expect(this.page.getByRole('switch', { name: '在新消息中使用' })).toBeChecked();
    await this.page.reload();
    await this.page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await restored(this.page);
    await this.evidence.check('enabled-preference-visible-after-reload', () =>
      expect(this.page.getByRole('button', { name: '个人偏好已启用' })).toBeVisible(),
    );
    await this.page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(this.page.getByRole('article', { name: '你的消息', exact: true })).toContainText(
      preference,
    );
    this.sessionId = submittedSession(this);
    this.assertions = () =>
      this.evidence.check('preference-in-single-submission', () => {
        const turn = this.cloud.submittedTurn(this.sessionId);
        expect(turn.inputConfig.prompt).toBe(
          `${this.draft}\n\n本次采用的个人偏好：\n${preference}`,
        );
        expect(turn.inputConfig.inputBlocks).toEqual([
          { type: 'text', text: turn.inputConfig.prompt },
        ]);
        expect(this.cloud.document(this.sessionId).getList('history').length).toBe(1);
      });
  },
);
When(
  'I disable and remove the preference while keeping my next draft',
  async function (this: JourneyWorld) {
    await this.page.getByRole('button', { name: '新建会话', exact: true }).click();
    await this.page.getByRole('textbox', { name: '消息', exact: true }).fill('下一条独立问题');
    await this.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await this.page.getByRole('button', { name: '对话偏好 回复指令与背景' }).click();
    await this.page.getByRole('switch', { name: '在新消息中使用' }).click();
    await expect(this.page.getByRole('switch', { name: '在新消息中使用' })).not.toBeChecked();
    await this.page.getByRole('button', { name: '删除偏好', exact: true }).click();
    await expect(this.page.getByRole('textbox', { name: '回复偏好与背景' })).toHaveValue('');
    await this.page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await this.evidence.check('deletion-preserves-draft', () =>
      expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
        '下一条独立问题',
      ),
    );
    await this.page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(this.page.getByRole('article', { name: '你的消息', exact: true })).toContainText(
      '下一条独立问题',
    );
    this.draft = '下一条独立问题';
    this.assertions = () =>
      this.evidence.check('disabled-preference-excluded', () =>
        expect(this.cloud.submittedTurn(submittedSession(this)).inputConfig.prompt).toBe(
          '下一条独立问题',
        ),
      );
  },
);

When(
  'I open dictation and the browser recognition boundary declines access',
  async function (this: JourneyWorld) {
    // Controlled microphone/recognition service boundaries, not real hardware or cloud STT.
    await this.context.addInitScript({
      content: `
      (() => {
        let starts = 0;
        let microphoneRequests = 0;
        let tracksStopped = 0;
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
          configurable: true,
          value: async () => {
            document.documentElement.dataset.microphoneRequests = String(++microphoneRequests);
            if (microphoneRequests === 1) throw new DOMException('Controlled denial', 'NotAllowedError');
            return { getTracks: () => [{ stop() {
              document.documentElement.dataset.tracksStopped = String(++tracksStopped);
            } }] };
          },
        });
        class ControlledRecognition {
          lang = ''; continuous = false; interimResults = false;
          onstart = null; onend = null; onerror = null; onresult = null;
          start() {
            starts++;
            document.documentElement.dataset.recognitionStarts = String(starts);
            if (starts === 1) { this.onerror?.({ error: 'not-allowed' }); this.onend?.(); return; }
            this.onstart?.();
            this.onresult?.({ results: [{ isFinal: true, length: 1, 0: { transcript: '识别出的文字' } }] });
            this.onend?.();
          }
          stop() { this.onend?.(); }
          abort() { this.onend?.(); }
        }
        Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: ControlledRecognition });
      })();
    `,
    });
    await this.page.reload();
    await ready(this);
    await this.page.getByRole('textbox', { name: '消息', exact: true }).fill(this.draft);
    await this.page.getByRole('button', { name: '语音输入', exact: true }).click();
    await this.evidence.check('opening-does-not-start-microphone', async () => {
      expect(await this.page.locator('html').getAttribute('data-recognition-starts')).toBeNull();
      expect(await this.page.locator('html').getAttribute('data-microphone-requests')).toBeNull();
    });
    await this.page.getByRole('button', { name: '开始听写', exact: true }).click();
    this.assertions = () =>
      this.evidence.check('microphone-denial-preserves-draft', async () => {
        await expect(this.page.getByRole('alert')).toContainText('麦克风权限未获准');
        await expect(this.page.locator('html')).toHaveAttribute('data-microphone-requests', '1');
        expect(await this.page.locator('html').getAttribute('data-recognition-starts')).toBeNull();
        await expect(
          this.page.getByRole('textbox', { name: '消息', exact: true, includeHidden: true }),
        ).toHaveValue(this.draft);
      });
  },
);
When(
  'I retry the controlled recognizer and review text before insertion',
  async function (this: JourneyWorld) {
    await this.page.getByRole('button', { name: '开始听写', exact: true }).click();
    await this.evidence.check('recognition-denial-preserves-draft', async () => {
      await expect(this.page.getByRole('alert')).toContainText('语音识别请求');
      await expect(this.page.locator('html')).toHaveAttribute('data-tracks-stopped', '1');
      await expect(
        this.page.getByRole('textbox', { name: '消息', exact: true, includeHidden: true }),
      ).toHaveValue(this.draft);
    });
    await this.page.getByRole('button', { name: '开始听写', exact: true }).click();
    await expect(this.page.getByRole('textbox', { name: '听写文字' })).toHaveValue('识别出的文字');
    await expect(this.page.locator('html')).toHaveAttribute('data-microphone-requests', '3');
    await expect(this.page.locator('html')).toHaveAttribute('data-recognition-starts', '2');
    await expect(this.page.locator('html')).toHaveAttribute('data-tracks-stopped', '2');
    await this.page.getByRole('textbox', { name: '听写文字' }).fill('经我确认的文字');
    await this.evidence.check('final-text-editable-before-insert', () =>
      expect(
        this.page.getByRole('textbox', { name: '消息', exact: true, includeHidden: true }),
      ).toHaveValue(this.draft),
    );
    await this.page.getByRole('button', { name: '加入草稿', exact: true }).click();
    this.assertions = () =>
      this.evidence.check('insertion-does-not-send', async () => {
        await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
          `${this.draft}\n经我确认的文字`,
        );
        expect(
          this.cloud.traffic.filter(
            (row) => row.kind === 'append' && row.stream.startsWith('workspace-a:s:'),
          ),
        ).toHaveLength(0);
      });
  },
);
