import type { Meta, StoryObj } from '@storybook/react-vite';
import * as stylex from '@stylexjs/stylex';

import { finalWorkItems, workItems } from '../../../../tests/fixtures/assistant-work';
import { Tooltip } from '../index';
import { MessageSurface } from '../MessageSurface';
import { readConversationContent } from './content';

const styles = stylex.create({
  page: { width: '100%', maxWidth: 760, marginInline: 'auto', padding: 16, minWidth: 0 },
});
const meta = {
  title: 'Chat/Official conversation',
  component: MessageSurface,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <Tooltip.Provider>
        <main {...stylex.props(styles.page)}>
          <Story />
        </main>
      </Tooltip.Provider>
    ),
  ],
  args: {
    role: 'agent',
    text: '',
    content: readConversationContent(workItems),
    status: 'streaming',
  },
} satisfies Meta<typeof MessageSurface>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Working: Story = {};
export const Finished: Story = {
  args: { content: readConversationContent(finalWorkItems), status: 'complete' },
};
export const Stopped: Story = { args: { status: 'stopped' } };
export const UnknownContent: Story = {
  args: {
    status: 'complete',
    content: readConversationContent([{ type: 'future_event', value: 42 }]),
  },
};

export const RichContent: Story = {
  args: {
    status: 'complete',
    content: readConversationContent([
      { type: 'goal', objective: '整理当前页面资料，并生成可下载的报告', status: 'complete' },
      {
        type: 'plan',
        entries: [
          { content: '读取已附加的页面', status: 'completed', priority: 'high' },
          { content: '交叉核对结论和来源', status: 'completed', priority: 'medium' },
          { content: '生成报告', status: 'completed', priority: 'low' },
        ],
      },
      {
        type: 'subagent_task',
        taskId: 'research',
        description: '核对来源',
        status: 'completed',
        summary: '已检查两份资料。',
        run: {
          sessionId: 'research-session',
          items: [
            { type: 'text', text: '检查页面中列出的来源。' },
            {
              type: 'tool_call',
              toolCallId: 'source-read',
              kind: 'read',
              status: 'completed',
              title: '读取已附加页面',
              rawOutput: '两份来源都可读取。',
            },
            { type: 'text', text: '来源检查完成。' },
          ],
        },
      },
      { type: 'text', text: '报告已整理，包含原文来源。' },
      {
        type: 'file',
        fileId: 'report',
        fileName: '网页资料核对报告.md',
        mimeType: 'text/markdown',
        sizeBytes: 256,
        sha256: 'demo',
        textPreview: true,
        transport: 'r2',
        uploadedAt: Date.now(),
      },
      { type: 'available_commands', commands: [{ name: 'review', description: '继续检查报告' }] },
    ]),
    contentActions: {
      loadAttachment: async () =>
        new Blob(
          ['# 核对报告\n\n两份资料已核对。\n\n<script>此内容只以文本显示，不执行。</script>'],
          { type: 'text/markdown' },
        ),
    },
  },
};
export const UnavailableAttachments: Story = {
  args: {
    status: 'complete',
    content: readConversationContent([
      {
        type: 'file',
        fileId: 'local',
        fileName: '等待上传的资料.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 512,
        sha256: 'demo',
        textPreview: false,
        transport: 'local',
        machineId: 'offline-machine',
        uploadedAt: Date.now(),
      },
      {
        type: 'file',
        fileId: 'expired',
        fileName: '已过期的报告.txt',
        mimeType: 'text/plain',
        sizeBytes: 512,
        sha256: 'demo',
        textPreview: true,
        transport: 'r2',
        uploadedAt: 0,
      },
      { type: 'file', path: '/Users/example/private/report.md' },
    ]),
  },
};
export const AttachmentFailure: Story = {
  args: {
    ...RichContent.args,
    contentActions: {
      loadAttachment: async () => {
        throw new Error('附件读取失败：访问凭证已过期。请重新连接后重试。');
      },
    },
  },
};
export const AgentNotice: Story = {
  args: {
    status: 'failed',
    content: readConversationContent([
      {
        type: 'system_notice',
        name: 'agent_warning',
        meta: { message: '当前模型的运行配置不支持此权限模式。', source: 'runtime' },
      },
      {
        type: 'system_notice',
        name: 'chat_failed',
        meta: { message: '连接中断，已保留本次部分回复。' },
      },
    ]),
  },
};
