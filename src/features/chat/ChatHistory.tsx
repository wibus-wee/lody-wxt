import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { Icon } from '../../shared/icons/Icon';
import { Button, Input, Popover } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';
import type { Conversation } from '../connection/client';

const styles = stylex.create({
  panel: {
    width: 'min(320px, calc(100vw - 24px))',
    maxHeight: 'min(480px, calc(100dvh - 100px))',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  list: { display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', minHeight: 0 },
  row: { justifyContent: 'start', width: '100%', minHeight: 44 },
  title: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  empty: { color: composer.hint, margin: 8, fontSize: 13 },
});

export function ChatHistory({
  conversations,
  selected,
  disabled,
  onOpen,
}: {
  conversations: readonly Conversation[];
  selected: string;
  disabled: boolean;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rows = conversations
    .filter((row) => row.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger render={<Button variant="ghost" size="small" icon aria-label="会话列表" />}>
        <Icon name="history" size={18} />
      </Popover.Trigger>
      <Popover.Content align="end" {...stylex.props(styles.panel)}>
        <Popover.Header>
          <Popover.Title>最近对话</Popover.Title>
        </Popover.Header>
        <Input
          aria-label="搜索对话"
          placeholder="搜索对话…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div {...stylex.props(styles.list)}>
          {rows.map((row) => (
            <Button
              key={row.id}
              variant={row.id === selected ? 'secondary' : 'ghost'}
              disabled={disabled}
              {...stylex.props(styles.row)}
              onClick={() => {
                setOpen(false);
                onOpen(row.id);
              }}
            >
              <Icon name="chat" size={16} />
              <span {...stylex.props(styles.title)}>{row.title}</span>
              {row.id === selected && <Icon name="check" size={14} />}
            </Button>
          ))}
          {!rows.length && (
            <output {...stylex.props(styles.empty)}>
              {search ? '没有找到相关对话' : '发出第一条消息后，对话会出现在这里。'}
            </output>
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
