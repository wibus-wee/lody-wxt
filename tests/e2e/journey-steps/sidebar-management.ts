import { readFile } from 'node:fs/promises';

import { When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { JourneyWorld } from './world';
import { ready, restored } from './world';

When(
  'I find a conversation by its body and manage it without losing my quick draft',
  async function (this: JourneyWorld) {
    await ready(this);
    await this.page.getByRole('textbox', { name: '消息', exact: true }).fill(this.draft);
    await this.page.getByRole('button', { name: '会话列表', exact: true }).click();
    await this.page
      .getByRole('textbox', { name: '搜索对话', exact: true })
      .fill('controlled HTTP snapshot');
    await expect(
      this.page.getByRole('button', { name: 'Historical conversation', exact: true }),
    ).toHaveCount(0);
    await this.page.getByRole('button', { name: '搜索全部可见对话正文', exact: true }).click();
    await this.evidence.check('fulltext-finds-body-without-switching-session', async () => {
      await expect(
        this.page.getByRole('button', { name: 'Historical conversation', exact: true }),
      ).toBeVisible();
      await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
        this.draft,
      );
      await expect(this.page.getByRole('article', { name: '你的消息', exact: true })).toHaveCount(
        0,
      );
    });
    await this.page
      .getByRole('button', { name: '管理对话 Historical conversation', exact: true })
      .click();
    await this.page.getByRole('menuitem', { name: '重命名', exact: true }).click();
    await this.page
      .getByRole('textbox', { name: '对话标题', exact: true })
      .fill('侧栏整理后的会话');
    await this.page.getByRole('button', { name: '保存标题', exact: true }).click();
    await this.page.getByRole('button', { name: '会话列表', exact: true }).click();
    await this.page.getByRole('button', { name: '管理对话 侧栏整理后的会话', exact: true }).click();
    await this.page.getByRole('menuitem', { name: '归档', exact: true }).click();
    this.assertions = () =>
      this.evidence.check('sidebar-rename-and-archive-observed', async () => {
        await expect(
          this.page.getByRole('button', { name: '侧栏整理后的会话', exact: true }),
        ).toHaveCount(0);
        await this.page.getByRole('button', { name: '查看已归档', exact: true }).click();
        await expect(
          this.page.getByRole('button', { name: '侧栏整理后的会话', exact: true }),
        ).toBeVisible();
      });
  },
);

When(
  'I reload and restore the sidebar conversation and export its history',
  async function (this: JourneyWorld) {
    await this.page.reload();
    await restored(this.page);
    await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
      this.draft,
    );
    await this.page.getByRole('button', { name: '会话列表', exact: true }).click();
    await this.page.getByRole('button', { name: '查看已归档', exact: true }).click();
    await this.page.getByRole('button', { name: '管理对话 侧栏整理后的会话', exact: true }).click();
    await this.page.getByRole('menuitem', { name: '恢复对话', exact: true }).click();
    await expect(
      this.page.getByRole('button', { name: '侧栏整理后的会话', exact: true }),
    ).toHaveCount(0);
    await this.page.getByRole('button', { name: '返回最近对话', exact: true }).click();
    await this.page.getByRole('button', { name: '侧栏整理后的会话', exact: true }).click();
    await this.evidence.check('sidebar-restores-same-history-after-reload', async () => {
      await expect(this.page.getByRole('article', { name: '你的消息', exact: true })).toContainText(
        'Previously asked question',
      );
      await expect(
        this.page.getByRole('article', { name: 'Agent 消息', exact: true }),
      ).toContainText('controlled HTTP snapshot');
    });
    await this.page.getByRole('button', { name: '会话列表', exact: true }).click();
    await this.page.getByRole('button', { name: '管理对话 侧栏整理后的会话', exact: true }).click();
    const downloadPromise = this.page.waitForEvent('download');
    await this.page.getByRole('menuitem', { name: '导出 Markdown', exact: true }).click();
    const download = await downloadPromise;
    const file = await download.path();
    await this.evidence.check('export-contains-original-history', async () => {
      expect(download.suggestedFilename()).toBe('侧栏整理后的会话.md');
      expect(file).not.toBeNull();
      const markdown = await readFile(file!, 'utf8');
      expect(markdown).toContain('Previously asked question');
      expect(markdown).toContain('controlled HTTP snapshot');
    });
    await this.page.keyboard.press('Escape');
    await this.page.getByRole('button', { name: '选择对话助手', exact: true }).click();
    await this.page.getByRole('button', { name: '连接诊断', exact: true }).click();
    await expect(this.page.getByLabel('诊断快照')).toContainText('history-a');
    const diagnosticDownload = this.page.waitForEvent('download');
    await this.page.getByRole('button', { name: '导出诊断', exact: true }).click();
    const diagnostic = await diagnosticDownload;
    this.assertions = () =>
      this.evidence.check('diagnostic-export-excludes-content-and-credentials', async () => {
        const path = await diagnostic.path();
        const text = await readFile(path!, 'utf8');
        expect(text).toContain('history-a');
        expect(text).not.toContain('Previously asked question');
        expect(text).not.toContain('controlled-stream-token');
        expect(text).not.toContain('controlled HTTP snapshot');
        expect(Object.keys(JSON.parse(text))).toEqual([
          'schemaVersion',
          'capturedAt',
          'surface',
          'extensionVersion',
          'connection',
          'failurePresent',
          'workspaceId',
          'machineId',
          'agentConfigId',
          'sessionId',
          'delivery',
          'capabilities',
          'available',
          'environment',
        ]);
      });
  },
);
