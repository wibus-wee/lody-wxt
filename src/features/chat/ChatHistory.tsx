import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';

import { Icon } from '../../shared/icons/Icon';
import { Button, Input, Menu, Popover } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';
import { Dialog } from '../../shared/ui/dialog';
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
  row: { justifyContent: 'start', flex: 1, minWidth: 0, minHeight: 44 },
  item: { display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 },
  title: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    flex: 1,
    textAlign: 'start',
  },
  hint: { color: composer.hint, margin: 0, fontSize: 12, lineHeight: 1.5 },
  empty: { color: composer.hint, margin: 8, fontSize: 13 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  footer: { display: 'flex', justifyContent: 'end', gap: 8 },
});
export interface ChatHistoryActions {
  rename?: (id: string, title: string) => Promise<void>;
  archive?: (id: string) => Promise<void>;
  restore?: (id: string) => Promise<void>;
  delete?: (id: string) => Promise<void>;
  export?: (id: string) => Promise<void>;
  share?: (id: string) => Promise<void>;
  search?: (
    query: string,
    signal: AbortSignal,
    progress: (done: number, total: number) => void,
  ) => Promise<{ ids: string[]; failed: string[] }>;
}
export function ChatHistory({
  conversations,
  selected,
  disabled,
  onOpen,
  actions,
}: {
  conversations: readonly (Conversation & { isArchived?: boolean })[];
  selected: string;
  disabled: boolean;
  onOpen: (id: string) => void;
  actions?: ChatHistoryActions | undefined;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [operation, setOperation] = useState<{
    kind: 'rename' | 'delete';
    row: Conversation;
  } | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [matches, setMatches] = useState<string[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState('');
  const searchRef = useRef<AbortController | null>(null);
  useEffect(() => () => searchRef.current?.abort(), []);
  async function fulltext() {
    if (!actions?.search) return;
    searchRef.current?.abort();
    const controller = new AbortController();
    searchRef.current = controller;
    setSearching(true);
    setError('');
    try {
      const result = await actions.search(search, controller.signal, (done, total) => {
        if (!controller.signal.aborted) setSearchProgress(`${done} / ${total}`);
      });
      if (controller.signal.aborted) return;
      setMatches(result.ids);
      if (result.failed.length)
        setError(`${result.failed.length} 段对话未能读取：${result.failed.join('；')}`);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (searchRef.current === controller) setSearching(false);
    }
  }
  const rows = conversations
    .filter(
      (row) =>
        !!row.isArchived === archived &&
        (matches
          ? matches.includes(row.id)
          : row.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),
    )
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
  const perform = async (action: (() => Promise<void>) | undefined, noticeText = '') => {
    if (!action || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setOperation(null);
      setNotice(noticeText);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          render={<Button variant="ghost" size="small" icon aria-label="会话列表" />}
        >
          <Icon name="history" size={18} />
        </Popover.Trigger>
        <Popover.Content ref={popupRef} align="end" {...stylex.props(styles.panel)}>
          <Popover.Header>
            <Popover.Title>{archived ? '已归档对话' : '最近对话'}</Popover.Title>
          </Popover.Header>
          <Input
            aria-label="搜索对话"
            placeholder="搜索对话标题…"
            value={search}
            onChange={(event) => {
              searchRef.current?.abort();
              setSearching(false);
              setMatches(null);
              setSearch(event.target.value);
            }}
          />
          <p {...stylex.props(styles.hint)}>
            {matches
              ? '全文结果：已检查当前工作区可见会话的正文、网页资料和工具记录'
              : `标题搜索：当前工作区已载入的 ${conversations.length} 段对话`}
          </p>
          {actions?.search && (
            <Button
              size="small"
              variant="ghost"
              disabled={!search.trim()}
              onClick={() =>
                searching ? (searchRef.current?.abort(), setSearching(false)) : void fulltext()
              }
            >
              {searching ? `取消搜索 ${searchProgress}` : '搜索全部可见对话正文'}
            </Button>
          )}
          {(actions?.archive || actions?.restore) && (
            <Button variant="ghost" size="small" onClick={() => setArchived(!archived)}>
              {archived ? '返回最近对话' : '查看已归档'}
            </Button>
          )}
          {error && !operation && (
            <output role="alert" {...stylex.props(styles.hint)}>
              {error}
            </output>
          )}
          {notice && <output {...stylex.props(styles.hint)}>{notice}</output>}
          <div {...stylex.props(styles.list)}>
            {rows.map((row) => (
              <div key={row.id} {...stylex.props(styles.item)}>
                <Button
                  variant={row.id === selected ? 'secondary' : 'ghost'}
                  disabled={disabled || busy}
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
                {actions && (
                  <Menu.Root>
                    <Menu.Trigger
                      render={
                        <Button
                          variant="ghost"
                          size="small"
                          icon
                          aria-label={`管理对话 ${row.title}`}
                          disabled={disabled || busy}
                        />
                      }
                    >
                      <Icon name="chevron" size={14} />
                    </Menu.Trigger>
                    <Menu.Content container={popupRef} align="end">
                      {actions.rename && (
                        <Menu.Item
                          onClick={() => {
                            setError('');
                            setTitle(row.title);
                            setOperation({ kind: 'rename', row });
                          }}
                        >
                          重命名
                        </Menu.Item>
                      )}
                      {actions.share && (
                        <Menu.Item
                          onClick={() => {
                            setOpen(false);
                            void perform(() => actions.share!(row.id));
                          }}
                        >
                          分享会话…
                        </Menu.Item>
                      )}
                      {actions.export && (
                        <Menu.Item onClick={() => void perform(() => actions.export!(row.id))}>
                          导出 Markdown
                        </Menu.Item>
                      )}
                      {!row.isArchived && actions.archive && (
                        <Menu.Item
                          onClick={() =>
                            void perform(
                              () => actions.archive!(row.id),
                              '归档请求已提交；列表以同步结果为准。',
                            )
                          }
                        >
                          归档
                        </Menu.Item>
                      )}
                      {row.isArchived && actions.restore && (
                        <Menu.Item onClick={() => void perform(() => actions.restore!(row.id))}>
                          恢复对话
                        </Menu.Item>
                      )}
                      {actions.delete && (
                        <Menu.Item
                          onClick={() => {
                            setError('');
                            setOperation({ kind: 'delete', row });
                          }}
                        >
                          删除对话…
                        </Menu.Item>
                      )}
                    </Menu.Content>
                  </Menu.Root>
                )}
              </div>
            ))}
            {!rows.length && (
              <output {...stylex.props(styles.empty)}>
                {search
                  ? '没有找到相关对话'
                  : archived
                    ? '还没有已归档对话。'
                    : '发出第一条消息后，对话会出现在这里。'}
              </output>
            )}
          </div>
        </Popover.Content>
      </Popover.Root>
      <Dialog.Root
        open={!!operation}
        onOpenChange={(next) => {
          if (!next && !busy) setOperation(null);
        }}
      >
        <Dialog.Content closeLabel="关闭">
          <Dialog.Title>{operation?.kind === 'delete' ? '删除对话' : '重命名对话'}</Dialog.Title>
          <Dialog.Description>
            {operation?.kind === 'delete'
              ? `删除“${operation.row.title}”的云端会话。此操作无法撤销，本地未发送的草稿不会因此删除。`
              : '修改当前工作区中的对话标题。'}
          </Dialog.Description>
          <form
            {...stylex.props(styles.form)}
            onSubmit={(event) => {
              event.preventDefault();
              if (!operation) return;
              void perform(
                operation.kind === 'rename'
                  ? () => actions!.rename!(operation.row.id, title.trim())
                  : () => actions!.delete!(operation.row.id),
                operation.kind === 'delete' ? '删除请求已提交；等待云端同步确认。' : '',
              );
            }}
          >
            {operation?.kind === 'rename' && (
              <Input
                aria-label="对话标题"
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={busy}
              />
            )}
            {error && <output role="alert">{error}</output>}
            <div {...stylex.props(styles.footer)}>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setOperation(null)}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={busy || (operation?.kind === 'rename' && !title.trim())}
              >
                {busy ? '正在提交…' : operation?.kind === 'delete' ? '删除云端对话' : '保存标题'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
