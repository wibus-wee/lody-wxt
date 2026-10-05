import * as stylex from '@stylexjs/stylex';
import type { KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { colors } from '../../../vendor/lody/packages/ui/src/tokens/colors.stylex';
import { Icon } from '../../shared/icons/Icon';
import { Button, Input, Menu, Popover } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';
import { Dialog } from '../../shared/ui/dialog';
import type { Conversation } from '../connection/client';

const styles = stylex.create({
  panel: { width: 'min(288px, calc(100vw - 24px))' },
  body: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 'min(360px, calc(100dvh - 120px))',
    minHeight: 0,
    gap: 8,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexShrink: 0,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflowY: 'auto',
    minHeight: 0,
    overscrollBehavior: 'contain',
  },
  row: {
    justifyContent: 'start',
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: 400,
    paddingInline: 8,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    minWidth: 0,
    flexShrink: 0,
    borderRadius: 6,
    backgroundColor: { default: 'transparent', ':focus-within': colors.hoverFill },
  },
  selected: { backgroundColor: colors.hoverFill },
  selectedRow: { color: colors.label },
  utility: { fontSize: 12, fontWeight: 400, color: composer.hint },
  search: { flexShrink: 0 },
  title: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    flex: 1,
    textAlign: 'start',
  },
  hint: {
    color: composer.hint,
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    overflowWrap: 'anywhere',
  },
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const [focusedId, setFocusedId] = useState('');
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
  const tabStop = rows.some((row) => row.id === focusedId) ? focusedId : rows[0]?.id;
  function navigate(event: KeyboardEvent<HTMLElement>, fromSearch = false) {
    if (
      event.nativeEvent.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-history-id]:not(:disabled)',
      ) ?? [],
    );
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (!fromSearch && index < 0) return;
    let next: HTMLButtonElement | HTMLInputElement | undefined | null;
    if (event.key === 'ArrowDown') next = buttons[Math.min(index + 1, buttons.length - 1)];
    else if (event.key === 'ArrowUp')
      next = fromSearch
        ? buttons.at(-1)
        : index === 0
          ? searchInputRef.current
          : buttons[index - 1];
    else if (!fromSearch && event.key === 'Home') next = buttons[0];
    else if (!fromSearch && event.key === 'End') next = buttons.at(-1);
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest' });
  }
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
        <Popover.Content
          ref={popupRef}
          initialFocus={searchInputRef}
          align="end"
          {...stylex.props(styles.panel)}
        >
          <div {...stylex.props(styles.body)} data-history-panel="">
            <div {...stylex.props(styles.header)}>
              <Popover.Title>{archived ? '已归档对话' : '最近对话'}</Popover.Title>
              {(actions?.archive || actions?.restore) && (
                <Button
                  variant="ghost"
                  size="mini"
                  {...stylex.props(styles.utility)}
                  aria-label={archived ? '返回最近对话' : '查看已归档'}
                  onClick={() => setArchived(!archived)}
                >
                  {archived ? '返回' : '已归档'}
                </Button>
              )}
            </div>
            <Input
              ref={searchInputRef}
              aria-label="搜索对话"
              size="small"
              {...stylex.props(styles.search)}
              placeholder="搜索对话标题…"
              value={search}
              onKeyDown={(event) => navigate(event, true)}
              onChange={(event) => {
                searchRef.current?.abort();
                setSearching(false);
                setMatches(null);
                setError('');
                setSearch(event.target.value);
              }}
            />
            {actions?.search && !!search.trim() && (
              <Button
                size="mini"
                variant="ghost"
                {...stylex.props(styles.utility)}
                aria-label={searching ? `取消搜索 ${searchProgress}` : '搜索全部可见对话正文'}
                onClick={() =>
                  searching ? (searchRef.current?.abort(), setSearching(false)) : void fulltext()
                }
              >
                <Icon name="search" size={12} />
                {searching ? `取消搜索 ${searchProgress}` : '搜索对话正文'}
              </Button>
            )}
            {matches && <p {...stylex.props(styles.hint)}>正文搜索 · {rows.length} 段结果</p>}
            {error && !operation && (
              <output role="alert" {...stylex.props(styles.hint)}>
                {error}
              </output>
            )}
            {notice && <output {...stylex.props(styles.hint)}>{notice}</output>}
            <section ref={listRef} {...stylex.props(styles.list)} aria-label="对话列表">
              {rows.map((row) => (
                <div
                  key={row.id}
                  {...stylex.props(styles.item, row.id === selected && styles.selected)}
                >
                  <Button
                    variant="ghost"
                    size="small"
                    aria-current={row.id === selected ? 'true' : undefined}
                    data-history-id={row.id}
                    tabIndex={row.id === tabStop ? 0 : -1}
                    onFocus={() => setFocusedId(row.id)}
                    onKeyDown={(event) => navigate(event)}
                    disabled={disabled || busy}
                    {...stylex.props(styles.row)}
                    onClick={() => {
                      setOpen(false);
                      onOpen(row.id);
                    }}
                  >
                    <span
                      {...stylex.props(styles.title, row.id === selected && styles.selectedRow)}
                    >
                      {row.title}
                    </span>
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
                            tabIndex={row.id === tabStop ? 0 : -1}
                            disabled={disabled || busy}
                          />
                        }
                      >
                        <Icon name="tools" size={14} />
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
              {!rows.length && !error && (
                <output {...stylex.props(styles.empty)}>
                  {searching
                    ? '正在搜索对话…'
                    : search
                      ? matches
                        ? '没有找到相关对话'
                        : '没有匹配的标题'
                      : archived
                        ? '还没有已归档对话。'
                        : '发出第一条消息后，对话会出现在这里。'}
                </output>
              )}
            </section>
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
