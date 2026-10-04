import type { PromptShortcut, ShortcutRuntimeSnapshot } from '@lody-mobile/sdk';
import { parsePromptShortcut, projectShortcutIndex } from '@lody-mobile/sdk';
import type { Meta, StoryObj } from '@storybook/react-vite';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { Button } from '../../shared/ui';
import type { ChatShortcuts, ClientSnapshot, LodyClient } from '../connection/client';
import { AutomationsPanel } from './AutomationsPanel';
import { ScheduleEditor } from './ScheduleEditor';

const target = {
  workspaceId: 'story-workspace',
  machineId: 'story-machine',
  agentConfigId: 'story-agent',
  project: { kind: 'chat' as const },
};
const snapshot: ClientSnapshot = {
  mode: 'real',
  status: 'connected',
  error: null,
  conversations: [],
  target,
  machineIds: ['story-machine'],
  machines: [
    {
      id: 'story-machine',
      name: 'Mac Studio',
      status: 'online',
      schedules: true,
      timeZone: 'Asia/Singapore',
    },
  ],
  agents: [{ id: 'story-agent', name: 'Codex', cliType: 'builtin', agentType: 'codex' }],
  runModels: [],
  permissionModes: [],
  busy: false,
};
const client: Pick<LodyClient, 'accountKey' | 'subscribe' | 'getSnapshot' | 'schedules'> = {
  accountKey: 'storybook-automation-isolated',
  subscribe: () => () => {},
  getSnapshot: () => snapshot,
  schedules: {
    list: async () => [],
    read: async () => null,
    runtimeRows: async () => [],
    save: async () => {
      throw new Error('Storybook 没有连接云端；任务没有保存。');
    },
    setEnabled: async () => {
      throw new Error('Storybook 没有连接云端。');
    },
    requestRun: async () => {
      throw new Error('Storybook 没有连接云端。');
    },
    delete: async () => {
      throw new Error('Storybook 没有连接云端。');
    },
  },
};
function storyShortcuts(failed: boolean): ChatShortcuts {
  const values = new Map<string, PromptShortcut>([
    [
      'story-private',
      parsePromptShortcut({
        v: 1,
        id: 'story-private',
        workspaceId: 'story-workspace',
        ownerUserId: 'story-account',
        visibility: 'private',
        name: '检查页面来源',
        slug: 'check-sources',
        prompt: '阅读附加资料，区分事实与推断，并列出需要进一步核对的来源。',
        scope: {},
        mentions: [],
        revision: 'private-r1',
        createdAt: 1,
        updatedAt: 1,
      }),
    ],
    [
      'story-shared',
      parsePromptShortcut({
        v: 1,
        id: 'story-shared',
        workspaceId: 'story-workspace',
        ownerUserId: 'story-colleague',
        visibility: 'workspace',
        name: '团队研究摘要',
        slug: 'team-summary',
        prompt: '用三句话总结附加资料，保留引用并列出后续问题。',
        scope: {},
        mentions: [],
        revision: 'shared-r1',
        createdAt: 1,
        updatedAt: 1,
      }),
    ],
  ]);
  let state: ShortcutRuntimeSnapshot = {
    entries: Array.from(values.values(), (value) =>
      projectShortcutIndex(value, `${value.id}-body`),
    ),
    pendingIds: failed ? ['story-private'] : [],
    errors: failed
      ? { 'story-private': new Error('演示：网络连接已中断，修改保留在此预览。') }
      : {},
    loading: false,
  };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    connect: async () => {},
    retry: async () => {
      state = { ...state, pendingIds: [], errors: {} };
      notify();
    },
    read: async (entry) => {
      const value = values.get(entry.id);
      if (!value || value.revision !== entry.revision)
        throw new Error('演示条目已变化，请重新选择。');
      return value;
    },
    save: async ({ value, bodyDocId }) => {
      const entry = projectShortcutIndex(parsePromptShortcut(value), bodyDocId);
      values.set(value.id, value);
      state = { ...state, entries: [...state.entries.filter((row) => row.id !== entry.id), entry] };
      notify();
      return entry;
    },
    remove: async (entry) => {
      values.delete(entry.id);
      state = { ...state, entries: state.entries.filter((row) => row.id !== entry.id) };
      notify();
    },
  };
}
const styles = stylex.create({
  page: { width: '100%', maxWidth: 520, minHeight: '100dvh', marginInline: 'auto' },
  editor: { padding: 16 },
  draft: { padding: 16, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
});
function Example({ schedule = false, failed = false }: { schedule?: boolean; failed?: boolean }) {
  const [shortcuts] = useState(() => storyShortcuts(failed));
  const [previewClient] = useState(() => ({
    ...client,
    shortcuts,
    shortcutContext: () => ({ workspaceId: 'story-workspace', userId: 'story-account', scope: {} }),
    listSkills: async () => [],
  }));
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(true);
  return (
    <main {...stylex.props(styles.page)}>
      <p {...stylex.props(styles.editor)}>
        Storybook 演示数据；修改只保留在本次预览，不会同步到 Lody。
      </p>
      {schedule ? (
        <div {...stylex.props(styles.editor)}>
          <ScheduleEditor
            document={null}
            target={target}
            snapshot={snapshot}
            busy={false}
            disabled={false}
            onSave={async () => {
              throw new Error('Storybook 没有连接云端；任务没有保存。');
            }}
          />
        </div>
      ) : open ? (
        <AutomationsPanel
          client={previewClient}
          accountId="story-account"
          workspaceId="story-workspace"
          target={target}
          initialPrompt="请总结附加资料，并保留来源。"
          onClose={() => setOpen(false)}
          onUseWorkflow={(value) => {
            setDraft(value.prompt);
            setOpen(false);
          }}
        />
      ) : (
        <div {...stylex.props(styles.draft)}>
          <output aria-label="已填入的草稿">{draft || '草稿为空'}</output>
          <Button onClick={() => setOpen(true)}>返回快捷指令</Button>
        </div>
      )}
    </main>
  );
}
const meta = {
  title: 'Automations/Workspace',
  component: Example,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SyncedShortcuts: Story = {};
export const PendingPublication: Story = { args: { failed: true } };
export const Schedule: Story = { args: { schedule: true } };
