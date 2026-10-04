import type { Meta, StoryObj } from '@storybook/react-vite';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import type { Conversation } from '../connection/client';
import { ChatHistory } from './ChatHistory';

const styles = stylex.create({
  page: { padding: 16, display: 'flex', justifyContent: 'end', minHeight: 480 },
});
const initial: Conversation[] = [
  {
    id: 'one',
    title: '网页资料核对与整理',
    target: {
      workspaceId: 'workspace',
      machineId: 'machine',
      agentConfigId: 'agent',
      project: { kind: 'chat' },
    },
    updatedAt: 3,
    messages: [],
  },
  {
    id: 'two',
    title: '一段足够长的对话名称应该在窄侧栏中截断而不挤掉旁边的管理按钮',
    target: {
      workspaceId: 'workspace',
      machineId: 'machine',
      agentConfigId: 'agent',
      project: { kind: 'chat' },
    },
    updatedAt: 2,
    messages: [],
  },
  {
    id: 'three',
    title: '已归档的研究',
    target: {
      workspaceId: 'workspace',
      machineId: 'machine',
      agentConfigId: 'agent',
      project: { kind: 'chat' },
    },
    updatedAt: 1,
    isArchived: true,
    messages: [],
  },
];
function HistoryExample({ failure = false }: { failure?: boolean }) {
  const [rows, setRows] = useState(initial);
  const [selected, setSelected] = useState('one');
  const update = async (id: string, changes: Partial<Conversation>) => {
    if (failure) throw new Error('未能同步：连接已断开。请重新连接后重试。');
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)));
  };
  return (
    <main {...stylex.props(styles.page)}>
      <ChatHistory
        conversations={rows}
        selected={selected}
        disabled={false}
        onOpen={setSelected}
        actions={{
          rename: (id, title) => update(id, { title }),
          archive: (id) => update(id, { isArchived: true }),
          restore: (id) => update(id, { isArchived: false }),
          delete: async (id) => {
            if (failure) throw new Error('删除未提交：连接已断开。');
            setRows((current) => current.filter((row) => row.id !== id));
          },
        }}
      />
    </main>
  );
}
const meta = {
  title: 'Chat/History management',
  component: HistoryExample,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof HistoryExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const History: Story = {};
export const SyncFailure: Story = { args: { failure: true } };
