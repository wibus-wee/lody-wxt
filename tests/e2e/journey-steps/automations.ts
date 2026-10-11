import assert from 'node:assert/strict';

import AxeBuilder from '@axe-core/playwright';
import { When } from '@cucumber/cucumber';
import * as v from 'valibot';

import { journeyExpect as expect } from '../../../tools/assurance/expect';
import type { JourneyWorld } from './world';
import { ready, restored } from './world';

const savedPublications = new WeakMap<JourneyWorld, { key: string; value: string }>();
const panelName = '快捷指令与定时任务';
const shortcutCard = (world: JourneyWorld, name: string) =>
  world.page.getByRole('region', { name: `快捷指令 ${name}`, exact: true });
const sessionWrites = (world: JourneyWorld) =>
  world.cloud.traffic.filter(
    (row) => row.kind === 'append' && row.stream.startsWith('workspace-a:s:'),
  );

When(
  'I discover Desktop private and shared shortcuts through scoped grants',
  async function (this: JourneyWorld) {
    await ready(this);
    await this.page.getByRole('textbox', { name: '消息', exact: true }).fill(this.draft);
    await this.page.getByRole('button', { name: panelName, exact: true }).click();
    await this.evidence.check('desktop-private-and-shared-discovered', async () => {
      await expect(shortcutCard(this, 'Desktop 私有检查')).toBeVisible();
      await expect(shortcutCard(this, '团队共享摘要')).toBeVisible();
      await expect(this.page.getByText('其他成员的私有内容', { exact: true })).toHaveCount(0);
      expect(
        this.cloud.shortcuts.requests.some((row) => row.operation === 'listAccessibleDocuments'),
      ).toBe(true);
      for (const width of [360, 400]) {
        await this.page.setViewportSize({ width, height: 780 });
        await expect(shortcutCard(this, 'Desktop 私有检查')).toBeVisible();
        expect(
          await this.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        expect(
          (await new AxeBuilder({ page: this.page }).withTags(['wcag2a', 'wcag2aa']).analyze())
            .violations,
        ).toEqual([]);
        await this.attach(`Synced shortcut manager at ${width}px`, 'text/plain');
        await this.attach(await this.page.screenshot(), 'image/png');
      }
      await this.page.setViewportSize({ width: 360, height: 780 });
    });
    await this.evidence.check('resource-grants-reject-workspace-token', async () => {
      const stream = 'shortcut-index:workspace-a:user-a:private';
      const denied = await this.page.evaluate(async (stream) => {
        const response = await fetch(
          `https://api.lody.ai/ds/lody/${encodeURIComponent(stream)}/bootstrap`,
          { headers: { authorization: 'Bearer controlled-stream-token' } },
        );
        return response.status;
      }, stream);
      expect(denied).toBe(403);
      expect(this.cloud.shortcuts.denied).toContainEqual({
        stream,
        token: 'controlled-stream-token',
      });
      const reads = this.cloud.shortcuts.traffic.filter((row) => row.method === 'GET');
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.every((row) => row.token.startsWith('shortcut-grant-'))).toBe(true);
      const privateGrant = reads.find((row) => row.stream === stream);
      assert.ok(privateGrant);
      const crossResource = await this.page.evaluate(async (token) => {
        const response = await fetch(
          `https://api.lody.ai/ds/lody/${encodeURIComponent('shortcut-body:desktop-shared-body')}/bootstrap`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        return response.status;
      }, privateGrant.token);
      expect(crossResource).toBe(403);
      expect(this.cloud.shortcuts.requests.some((row) => row.operation === 'getStreamToken')).toBe(
        true,
      );
    });
    this.assertions = () =>
      this.evidence.check('shared-member-shortcut-readonly', async () => {
        const card = shortcutCard(this, '团队共享摘要');
        await expect(card.getByRole('button', { name: '使用', exact: true })).toBeEnabled();
        await expect(card.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
        await expect(card.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
        expect(
          this.cloud.shortcuts.traffic.filter((row) => row.stream.includes('user-b') && row.write),
        ).toHaveLength(0);
      });
  },
);

When(
  'I edit, restore, use and share a synchronized shortcut without sending',
  async function (this: JourneyWorld) {
    await shortcutCard(this, 'Desktop 私有检查')
      .getByRole('button', { name: '编辑', exact: true })
      .click();
    await this.page
      .getByRole('region', { name: '同步快捷指令', exact: true })
      .getByRole('textbox', { name: '名称', exact: true })
      .fill('浏览器与 Desktop 同步');
    await this.page
      .getByRole('region', { name: '同步快捷指令', exact: true })
      .getByRole('textbox', { name: '提示词', exact: true })
      .fill('读取附加资料，并检查结论的来源。');
    await this.page.getByRole('button', { name: '保存快捷指令', exact: true }).click();
    await expect
      .poll(() => this.cloud.shortcuts.content('desktop-private').prompt)
      .toBe('读取附加资料，并检查结论的来源。');
    await this.page.reload();
    await restored(this.page);
    await this.page.getByRole('button', { name: panelName, exact: true }).click();
    await this.evidence.check('body-and-index-revision-survive-reload', async () => {
      await expect(shortcutCard(this, '浏览器与 Desktop 同步')).toBeVisible();
      const content = this.cloud.shortcuts.content('desktop-private');
      expect(content.revision).not.toBe('desktop-private-r1');
      expect(this.cloud.shortcuts.indexEntry(content.id)).toMatchObject({
        kind: 'active',
        entry: { id: content.id, revision: content.revision, name: content.name },
      });
      const activation = this.cloud.shortcuts.requests.find(
        (row) => row.operation === 'activateDocument',
      );
      expect(activation?.args).toMatchObject({
        previousBodyDocId: 'desktop-private-body',
        previousRevision: 'desktop-private-r1',
        revision: content.revision,
      });
    });
    await shortcutCard(this, '浏览器与 Desktop 同步')
      .getByRole('button', { name: '使用', exact: true })
      .click();
    await this.evidence.check('use-preserves-existing-draft-without-send', async () => {
      await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
        `${this.draft}\n\n读取附加资料，并检查结论的来源。`,
      );
      expect(sessionWrites(this)).toHaveLength(0);
    });
    await this.page.getByRole('button', { name: panelName, exact: true }).click();
    const prior = this.cloud.shortcuts.active().find((row) => row.shortcutId === 'desktop-private');
    assert.ok(prior?.publication);
    const expectedBody = prior.bodyDocId;
    const expectedRevision = prior.publication.revision;
    await shortcutCard(this, '浏览器与 Desktop 同步')
      .getByRole('button', { name: '编辑', exact: true })
      .click();
    await this.page.getByRole('switch', { name: '与工作区共享', exact: true }).click();
    await this.page.getByRole('button', { name: '保存快捷指令', exact: true }).click();
    await this.evidence.check('sharing-rotates-body-with-cas', async () => {
      await expect
        .poll(() => this.cloud.shortcuts.content('desktop-private').visibility)
        .toBe('workspace');
      const current = this.cloud.shortcuts
        .active()
        .find((row) => row.shortcutId === 'desktop-private');
      expect(current?.bodyDocId).not.toBe(expectedBody);
      const activations = this.cloud.shortcuts.requests.filter(
        (row) => row.operation === 'activateDocument',
      );
      expect(activations.at(-1)?.args).toMatchObject({
        previousBodyDocId: expectedBody,
        previousRevision: expectedRevision,
        bodyDocId: current?.bodyDocId,
      });
      expect(this.cloud.shortcuts.indexEntry('desktop-private')).toMatchObject({
        kind: 'active',
        entry: { visibility: 'workspace', bodyDocId: current?.bodyDocId },
      });
    });
    this.assertions = async () => {
      expect(
        (await new AxeBuilder({ page: this.page }).withTags(['wcag2a', 'wcag2aa']).analyze())
          .violations,
      ).toEqual([]);
    };
  },
);

When(
  'I delete my synchronized shortcut and check private isolation',
  async function (this: JourneyWorld) {
    await shortcutCard(this, '浏览器与 Desktop 同步')
      .getByRole('button', { name: '删除', exact: true })
      .click();
    await this.page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
    this.assertions = () =>
      this.evidence.check('deletion-revokes-and-isolates-private-content', async () => {
        await expect(shortcutCard(this, '浏览器与 Desktop 同步')).toHaveCount(0);
        await expect
          .poll(() =>
            this.cloud.shortcuts.active().some((row) => row.shortcutId === 'desktop-private'),
          )
          .toBe(false);
        await expect(this.page.getByText('删除待同步', { exact: true })).toHaveCount(0);
        expect(
          this.cloud.shortcuts.requests.some(
            (row) =>
              row.operation === 'revokeShortcut' && row.args.shortcutId === 'desktop-private',
          ),
        ).toBe(true);
        await this.page.reload();
        await restored(this.page);
        await this.page.getByRole('button', { name: panelName, exact: true }).click();
        await expect(shortcutCard(this, '浏览器与 Desktop 同步')).toHaveCount(0);
        await expect(shortcutCard(this, '团队共享摘要')).toBeVisible();
        expect(
          this.cloud.shortcuts.traffic.some(
            (row) => row.stream === 'shortcut-body:other-private-body',
          ),
        ).toBe(false);
        expect(sessionWrites(this)).toHaveLength(0);
      });
  },
);

When(
  'I preview and cancel migration of a legacy local shortcut',
  async function (this: JourneyWorld) {
    await ready(this);
    await this.page.getByRole('textbox', { name: '消息', exact: true }).fill(this.draft);
    const accountKey = JSON.stringify([
      JSON.stringify(['https://backend.lody.ai', 'lody-cli', 'user-a', 'workspace-a']),
      'https://convex.lody.ai',
    ]);
    this.requestId = `lody:automation:workflows:${JSON.stringify([accountKey, 'workspace-a'])}`;
    await this.page.evaluate((key) => {
      localStorage.setItem(
        key,
        JSON.stringify([
          {
            id: 'legacy-browser-template',
            title: '旧浏览器模板',
            prompt: '整理 {{主题}}，输出 {{格式}}。',
            includeCurrentPage: true,
            updatedAt: 1,
          },
        ]),
      );
      localStorage.setItem(
        `lody:automation:workflows:${JSON.stringify(['another-deployment-account', 'workspace-a'])}`,
        JSON.stringify([
          {
            id: 'other-legacy',
            title: '另一个部署的私有模板',
            prompt: '不要上传',
            includeCurrentPage: false,
            updatedAt: 1,
          },
        ]),
      );
    }, this.requestId);
    await this.page.getByRole('button', { name: panelName, exact: true }).click();
    await this.evidence.check('legacy-records-never-upload-on-open', async () => {
      await expect(
        this.page.getByRole('region', { name: '本地快捷指令迁移', exact: true }),
      ).toContainText('旧浏览器模板');
      expect(
        this.cloud.shortcuts.requests.filter((row) => row.operation === 'stageDocument'),
      ).toHaveLength(0);
      await expect(this.page.getByText('另一个部署的私有模板', { exact: true })).toHaveCount(0);
    });
    await this.page.getByRole('button', { name: '迁移到 Lody', exact: true }).click();
    const dialog = this.page.getByRole('dialog', { name: '迁移本地快捷指令', exact: true });
    await expect(dialog).toContainText('整理 {{主题}}，输出 {{格式}}。');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    this.assertions = () =>
      this.evidence.check('migration-preview-cancel-preserves-local', async () => {
        expect(
          this.cloud.shortcuts.requests.filter((row) => row.operation === 'stageDocument'),
        ).toHaveLength(0);
        expect(
          await this.page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), this.requestId),
        ).toMatchObject([{ id: 'legacy-browser-template', includeCurrentPage: true }]);
        expect(sessionWrites(this)).toHaveLength(0);
      });
  },
);

When(
  'I explicitly migrate the legacy shortcut and restore its synchronized copy',
  async function (this: JourneyWorld) {
    await this.page.getByRole('button', { name: '迁移到 Lody', exact: true }).click();
    await this.page
      .getByRole('dialog', { name: '迁移本地快捷指令', exact: true })
      .getByRole('button', { name: '确认迁移', exact: true })
      .click();
    await this.evidence.check('confirmed-migration-publishes-private-once', async () => {
      await expect(shortcutCard(this, '旧浏览器模板')).toBeVisible();
      const staged = this.cloud.shortcuts.requests.filter(
        (row) => row.operation === 'stageDocument',
      );
      expect(new Set(staged.map((row) => row.args.shortcutId)).size).toBe(1);
      const id = v.parse(v.string(), staged[0]?.args.shortcutId);
      const content = this.cloud.shortcuts.content(id);
      expect(content.prompt).toBe('整理 {{主题}}，输出 {{格式}}。');
      expect(content.visibility).toBe('private');
      expect(content).not.toHaveProperty('includeCurrentPage');
    });
    await this.page.reload();
    await restored(this.page);
    await this.page.getByRole('button', { name: panelName, exact: true }).click();
    this.assertions = () =>
      this.evidence.check('migration-reload-retains-cloud-and-draft', async () => {
        await expect(shortcutCard(this, '旧浏览器模板')).toBeVisible();
        const staged = this.cloud.shortcuts.requests.filter(
          (row) => row.operation === 'stageDocument',
        );
        expect(new Set(staged.map((row) => row.args.shortcutId)).size).toBe(1);
        expect(
          await this.page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), this.requestId),
        ).toMatchObject([{ id: 'legacy-browser-template' }]);
        expect(sessionWrites(this)).toHaveLength(0);
      });
  },
);

When('I stage a schedule whose registry publication fails', async function (this: JourneyWorld) {
  await ready(this);
  await this.page.getByRole('button', { name: panelName, exact: true }).click();
  await this.page.getByRole('button', { name: '新建', exact: true }).last().click();
  await this.page.getByRole('textbox', { name: '任务名称', exact: true }).fill('持久化研究任务');
  await this.page
    .getByRole('textbox', { name: '提示词', exact: true })
    .fill('整理最近一次会话中附加的资料。');
  this.cloud.failNextScheduleRegistryPublication();
  await this.page.getByRole('button', { name: '保存定时任务', exact: true }).click();
  await expect(this.page.getByRole('button', { name: '恢复上次操作', exact: true })).toBeVisible();
  const saved = await this.page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith('lody:automation:schedule-operation:'),
    )!;
    return { key, value: JSON.parse(localStorage.getItem(key)!) };
  });
  assert.ok(saved.value.operation);
  const operation = saved.value.operation;
  savedPublications.set(this, { key: saved.key, value: JSON.stringify(saved.value) });
  this.assertions = () =>
    this.evidence.check('failed-publication-visible-and-retained', async () => {
      await expect(this.page.getByRole('alert')).not.toBeEmpty();
      expect(operation.kind).toBe('save');
      expect(this.cloud.readSchedule(operation.input.scheduleId).toJSON()).toBeTruthy();
    });
});
When(
  'I reload and recover the exact schedule mutation then observe machine status',
  async function (this: JourneyWorld) {
    const retained = savedPublications.get(this);
    assert.ok(retained);
    const saved = { key: retained.key, value: JSON.parse(retained.value) };
    const operation = saved.value.operation;
    this.cloud.restoreWriteConfirmation();
    await this.page.reload();
    await restored(this.page);
    await this.page.getByRole('button', { name: panelName, exact: true }).click();
    await this.evidence.check('same-schedule-and-mutation-after-reload', async () => {
      expect(
        await this.page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), saved.key),
      ).toEqual(saved.value);
    });
    await this.page.getByRole('button', { name: '恢复上次操作', exact: true }).click();
    await expect(this.page.getByRole('button', { name: '恢复上次操作', exact: true })).toHaveCount(
      0,
    );
    await expect(
      this.page.getByRole('heading', { name: '持久化研究任务', exact: true }),
    ).toBeVisible();
    const rows = this.cloud.scheduleRegistryRows();
    const row = rows.find(
      (row) => row.key[0] === 'schedule' && row.key[1] === operation.input.scheduleId,
    )?.value as { scheduleId: string; activationId: string; definitionFingerprint: string };
    assert.ok(row);
    await this.evidence.check('registry-matches-durable-document', async () => {
      const document = this.cloud.readSchedule(row.scheduleId).toJSON();
      expect(JSON.stringify(document)).toContain(operation.input.activityId);
      expect(row.activationId).toBe(operation.input.activationId);
      expect(
        await this.page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).operation,
          saved.key,
        ),
      ).toBeNull();
    });
    await expect(this.page.getByText('等待机器确认下次运行', { exact: true })).toBeVisible();
    this.cloud.setScheduleRuntime({
      scheduleId: row.scheduleId,
      machineId: 'machine-a',
      activationId: row.activationId,
      observedDefinitionFingerprint: row.definitionFingerprint,
      nextScheduledAt: 1791200000000,
      queueState: 'blocked',
      blockedCode: 'Controlled agent unavailable',
      updatedAt: Date.now(),
    });
    await this.page.getByRole('button', { name: '刷新', exact: true }).click();
    await this.evidence.check('runtime-status-not-inferred-from-save', async () => {
      await expect(
        this.page.getByText('运行状态：已阻塞 · Controlled agent unavailable', { exact: true }),
      ).toBeVisible();
      await expect(this.page.getByText('下次运行：', { exact: false })).toBeVisible();
    });
    this.assertions = async () => {
      expect(
        (await new AxeBuilder({ page: this.page }).withTags(['wcag2a', 'wcag2aa']).analyze())
          .violations,
      ).toEqual([]);
    };
  },
);
