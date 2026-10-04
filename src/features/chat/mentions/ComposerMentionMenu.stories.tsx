import type { Meta, StoryObj } from '@storybook/react-vite';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';

import { Button } from '../../../shared/ui';
import { Composer } from '../Composer';
import type { MentionMenuRow } from './ComposerMentionMenu';
import { ComposerMentionMenu } from './ComposerMentionMenu';

const styles = stylex.create({
  anchor: { position: 'relative' },
  frame: { padding: 12, paddingTop: 360, width: 'min(100%, 380px)' },
});
const rows: MentionMenuRow[] = [
  {
    type: 'item',
    id: 'compact',
    item: {
      id: 'compact',
      kind: 'command',
      label: '/compact',
      description: '压缩当前上下文',
      prepare: async () => ({ text: '/compact' }),
    },
  },
  {
    type: 'item',
    id: 'shared',
    item: {
      id: 'shared',
      kind: 'shortcut',
      label: 'team-summary',
      description: '团队摘要 · 工作区共享',
      prepare: async () => ({ text: '请总结网页。' }),
    },
  },
  {
    type: 'item',
    id: 'unavailable',
    item: {
      id: 'unavailable',
      kind: 'shortcut',
      label: 'project-review',
      disabledReason: '需要切换到快捷指令所属项目。',
      prepare: async () => {
        throw new Error('不可用');
      },
    },
  },
];
function Preview({
  loading = false,
  error = '',
  categories = false,
}: {
  loading?: boolean;
  error?: string;
  categories?: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  return (
    <div {...stylex.props(styles.frame)}>
      <div ref={anchorRef} {...stylex.props(styles.anchor)}>
        <Composer
          value={categories ? '@' : '/'}
          disabled={false}
          onChange={() => {}}
          onKeyDown={() => {}}
          attachments={null}
          attachmentAction={null}
          configuration={null}
          primaryAction={<Button size="small">发送</Button>}
        />
        <ComposerMentionMenu
          anchor={anchorRef}
          listId="preview-mentions"
          rows={
            loading || error
              ? []
              : categories
                ? [
                    { type: 'category', id: 'session', category: 'session' },
                    { type: 'category', id: 'skill', category: 'skill' },
                    { type: 'category', id: 'tab', category: 'tab' },
                  ]
                : rows
          }
          selected={selected}
          loading={loading}
          preparing={false}
          error={error}
          onHighlight={setSelected}
          onClose={() => {}}
          onSelect={() => {}}
          onRetry={() => {}}
        />
      </div>
    </div>
  );
}
const meta = { title: 'Chat/Composer mentions', component: Preview } satisfies Meta<typeof Preview>;
export default meta;
export const Commands: StoryObj<typeof meta> = {};
export const Categories: StoryObj<typeof meta> = { args: { categories: true } };
export const Loading: StoryObj<typeof meta> = { args: { loading: true } };
export const ReadFailure: StoryObj<typeof meta> = {
  args: { error: '快捷指令目录读取失败，草稿已保留。' },
};
