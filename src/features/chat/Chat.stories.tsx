import type { Meta, StoryObj } from '@storybook/react-vite';

import { Icon } from '../../shared/icons/Icon';
import { Button, Tooltip } from '../../shared/ui';
import { ActivityStatus } from '../../shared/ui/ActivityStatus';
import { MessageAttachments } from '../../shared/ui/MessageAttachments';
import { Chat } from './Chat';
import { ChatHeader } from './ChatHeader';

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
        activities: [
          {
            id: 'read',
            title: '读取类型定义',
            command: 'read settings.ts',
            output: 'interface Settings { theme?: string }',
            status: 'complete',
          },
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
    footer: '仅发送你附加的网页',
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

export const LongPageTitle: Story = {
  args: {
    messages: [
      {
        id: 'attached-question',
        role: 'user',
        status: 'complete',
        timestamp: '02:18',
        text: '能告诉我现在在看什么页面吗？有什么信息',
        attachments: (
          <MessageAttachments
            contexts={[
              {
                id: 'page',
                title:
                  'LodyAI/Lody: Share coding agents with your team on phone and desktop — '.repeat(
                    5,
                  ),
              },
            ]}
          />
        ),
      },
    ],
    status: <ActivityStatus busy>等待助手回复</ActivityStatus>,
  },
};

export const Connecting: Story = {
  args: {
    messages: [],
    status: <ActivityStatus busy>连接工作区</ActivityStatus>,
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
