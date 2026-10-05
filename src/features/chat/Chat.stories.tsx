import type { Meta, StoryObj } from '@storybook/react-vite';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { Icon } from '../../shared/icons/Icon';
import { Button, Tooltip } from '../../shared/ui';
import { ActivityStatus } from '../../shared/ui/ActivityStatus';
import { ContextStrip } from '../page-context/ContextStrip';
import type { PageContext } from '../page-context/model';
import { Chat } from './Chat';
import { ChatHeader } from './ChatHeader';
import { ComposerContextBar } from './ComposerContextBar';

function ContextControlsPreview({ disabled = false }: { disabled?: boolean }) {
  const [currentPage, setCurrentPage] = useState(false);
  return (
    <ComposerContextBar
      disabled={disabled}
      currentPage={currentPage}
      onCurrentPageChange={setCurrentPage}
      onSelectTabs={() => {}}
    />
  );
}

const meta = {
  title: 'Chat/Transcript',
  component: Chat,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <Tooltip.Provider>
        <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
          <Story />
        </main>
      </Tooltip.Provider>
    ),
  ],
  args: {
    messages: [
      {
        id: 'user',
        role: 'user',
        text: '请说明 TypeScript 的可选属性。',
        status: 'complete',
        timestamp: '09:41',
      },
      {
        id: 'agent',
        role: 'agent',
        text: '## 可选属性\n\n属性可以不存在，但存在时仍须满足类型。\n\n```ts\ninterface Settings {\n  theme?: string;\n}\n```\n\n| 属性 | 类型 |\n| --- | --- |\n| theme | string |',
        status: 'complete',
        timestamp: '09:42',
        content: [
          {
            type: 'tool_call',
            toolCallId: 'read',
            title: '读取类型定义',
            kind: 'read',
            status: 'completed',
            content: [
              { type: 'terminal_command', command: 'read settings.ts' },
              { type: 'terminal_output', output: 'interface Settings { theme?: string }' },
            ],
          },
          { type: 'text', text: '## 可选属性\n\n属性可以不存在，但存在时仍须满足类型。' },
        ],
      },
    ],
    conversationControl: (
      <ChatHeader>
        <Button variant="ghost" size="small" icon aria-label="会话列表">
          <Icon name="history" size={18} />
        </Button>
        <Button variant="ghost" size="small" icon aria-label="新建会话">
          <Icon name="new" size={18} />
        </Button>
      </ChatHeader>
    ),
    onSubmit: () => {},
    contextControls: <ContextControlsPreview />,
    composer: {
      value: '',
      disabled: false,
      onChange: () => {},
      onKeyDown: () => {},
      attachments: null,
      attachmentAction: (
        <Button variant="ghost" size="small" icon aria-label="附加上下文">
          <Icon name="plus" size={16} />
        </Button>
      ),
      configuration: (
        <Button variant="ghost" size="small">
          运行配置
        </Button>
      ),
      primaryAction: (
        <Button type="submit" size="small" icon aria-label="发送消息">
          <Icon name="send" size={16} />
        </Button>
      ),
    },
  },
} satisfies Meta<typeof Chat>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Transcript: Story = {};

export const NewConversation: Story = {
  args: {
    messages: [],
    onSuggestion: () => {},
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const LongDraft: Story = {
  args: {
    messages: [],
    composer: { ...meta.args.composer, value: '帮我理清这篇文章的论点。\n'.repeat(25) },
  },
};

export const DeliveryRecovery: Story = {
  args: {
    messages: [],
    feedback: <output>发送结果待确认，草稿已保留。</output>,
    composer: { ...meta.args.composer, value: '这条消息的草稿会保留。' },
  },
};

const pageAttachments: PageContext[] = Array.from({ length: 8 }, (_, index) => ({
  id: `page-${index}`,
  kind: 'page',
  title:
    index === 0
      ? 'LodyAI/Lody: Share coding agents with your team on phone and desktop — '.repeat(2)
      : index < 3
        ? 'Menu · Raycast UI'
        : `资料 ${index + 1} — ${'LongUnbrokenPageTitle'.repeat(6)}`,
  url: `https://example.com/source/${index}`,
  text: `Source ${index + 1} contents`,
  trust: 'untrusted',
}));

export const LongPageTitle: Story = {
  args: {
    messages: [
      {
        id: 'attached-question',
        role: 'user',
        status: 'complete',
        timestamp: '02:18',
        text: '能告诉我现在在看什么页面吗？有什么信息',
        attachments: <ContextStrip contexts={pageAttachments.slice(0, 1)} layout="message" />,
      },
    ],
    status: <ActivityStatus busy>等待助手回复</ActivityStatus>,
  },
};

export const ManyPageAttachments: Story = {
  args: {
    ...LongPageTitle.args,
    messages: [
      {
        id: 'many-sources',
        role: 'user',
        status: 'complete',
        timestamp: '01:12',
        text: '看看我都给你发了什么东西，全部说一下？',
        attachments: <ContextStrip contexts={pageAttachments} layout="message" />,
      },
    ],
    composer: {
      ...meta.args.composer,
      attachments: <ContextStrip contexts={pageAttachments} remove={() => {}} />,
    },
  },
};

export const Connecting: Story = {
  args: {
    messages: [],
    status: <ActivityStatus busy>连接工作区</ActivityStatus>,
    contextControls: <ContextControlsPreview disabled />,
    composer: { ...meta.args.composer, disabled: true },
  },
};

export const WaitingForConfiguration: Story = {
  args: {
    messages: [],
    status: (
      <ActivityStatus
        busy
        action={
          <Button variant="ghost" size="small">
            刷新助手配置
          </Button>
        }
      >
        获取模型配置
      </ActivityStatus>
    ),
  },
};

export const Streaming: Story = {
  args: {
    messages: [
      meta.args.messages[0]!,
      {
        id: 'streaming',
        role: 'agent',
        text: '这篇文章主要讨论如何让团队更顺畅地协作。',
        status: 'streaming',
      },
    ],
  },
};

const scrollPreview = stylex.create({
  shell: { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 },
  controls: { display: 'flex', flexWrap: 'wrap', gap: 4, padding: 8 },
});

function ScrollFollowingExample() {
  const [paragraphs, setParagraphs] = useState(18);
  const [draft, setDraft] = useState('');
  return (
    <div {...stylex.props(scrollPreview.shell)}>
      <div {...stylex.props(scrollPreview.controls)}>
        <Button size="mini" onClick={() => setParagraphs((count) => count + 1)}>
          追加回复
        </Button>
        <Button size="mini" onClick={() => setParagraphs(1)}>
          缩短回复
        </Button>
        <Button size="mini" onClick={() => setDraft('保留我的阅读位置。\n'.repeat(8))}>
          增高输入框
        </Button>
      </div>
      <Chat
        {...meta.args}
        messages={[
          meta.args.messages[0]!,
          {
            id: 'scroll-answer',
            role: 'agent',
            status: 'streaming',
            text: Array.from(
              { length: paragraphs },
              (_, index) => `第 ${index + 1} 段。向上阅读时保留位置，回到最新后继续跟随回复。`,
            ).join('\n\n'),
          },
        ]}
        composer={{ ...meta.args.composer, value: draft, onChange: setDraft }}
      />
    </div>
  );
}

export const ScrollFollowing: Story = { render: () => <ScrollFollowingExample /> };
