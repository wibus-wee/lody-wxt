import { prepareSharePackage } from '@lody-mobile/sdk';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../../shared/ui';
import type { ShareClient } from './publisher';
import { ShareDialog } from './ShareDialog';

function Example({ configured = true }: { configured?: boolean }) {
  const [open, setOpen] = useState(true);
  const [client] = useState<ShareClient>(() => ({
    accountKey: `storybook-share-${configured ? 'configured' : 'unconfigured'}`,
    sharing: {
      publicOrigin: configured ? 'https://share.example.test' : undefined,
      apiOrigin: configured ? 'https://share-api.example.test' : undefined,
      verifyCredential: async () => {
        throw new Error('没有连接发布服务');
      },
      list: async () => ({ page: [], isDone: true, continueCursor: '' }),
      getManagement: async () => null,
      prepare: async () =>
        prepareSharePackage({
          rootSourceId: 'story-session',
          capturedAt: new Date().toISOString(),
          conversations: [
            {
              sourceId: 'story-session',
              title: '网页总结',
              history: [
                {
                  id: 'user',
                  role: 'user',
                  items: [{ type: 'text', text: '请总结这个页面的内容。' }],
                },
                {
                  id: 'assistant',
                  role: 'agent',
                  items: [
                    {
                      type: 'text',
                      text: '这是准备分享的示例内容。\n\n- 第一项发现\n- 第二项发现\n\n分享前请检查工具输出、网页资料和图片。',
                    },
                  ],
                },
              ],
            },
          ],
          readAttachment: async () => {
            throw new Error('示例没有附件');
          },
        }),
      beginDeployment: async () => {
        throw new Error('Storybook 没有连接发布服务；预览和恢复信息已保留。');
      },
      upload: async () => {
        throw new Error('没有连接发布服务');
      },
      publishDeployment: async () => {
        throw new Error('没有连接发布服务');
      },
      resetCredential: async () => {
        throw new Error('没有连接发布服务');
      },
      revoke: async () => {
        throw new Error('没有连接发布服务');
      },
    },
  }));
  return open ? (
    <ShareDialog
      client={client}
      sessionId="story-session"
      title="网页总结"
      onClose={() => setOpen(false)}
    />
  ) : (
    <Button onClick={() => setOpen(true)}>分享会话</Button>
  );
}
const meta = {
  title: 'Sharing/Session',
  component: Example,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Preview: Story = {};
export const MissingConfiguration: Story = { args: { configured: false } };
