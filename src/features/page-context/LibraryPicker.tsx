import { colors } from '@lody/ui/tokens/colors.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { Button, Field, Input, Select } from '../../shared/ui';
import { Dialog } from '../../shared/ui/dialog';
import type { LibraryEntry, LibraryKind } from './library';
import {
  addBookmark,
  deleteBookmark,
  libraryContext,
  listBookmarkFolders,
  moveBookmark,
  revokeLibraryAccess,
  searchLibrary,
} from './library';
import type { PageContext } from './model';

const styles = stylex.create({
  controls: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBlock: 12 },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxHeight: '35vh',
    overflowY: 'auto',
    marginBlock: 12,
  },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  text: { flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 13 },
  detail: { fontSize: 12, color: colors.secondaryLabel, overflowWrap: 'anywhere', marginBlock: 4 },
  fields: { display: 'flex', flexDirection: 'column', gap: 8 },
});

export function LibraryPicker({
  onAdd,
  onClose,
}: {
  onAdd: (context: PageContext) => void | Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<LibraryKind>('bookmarks');
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [days, setDays] = useState(1);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [moving, setMoving] = useState<LibraryEntry | null>(null);
  const [folders, setFolders] = useState<Array<{ id: string; title: string }>>([]);
  const [folderId, setFolderId] = useState('');
  const [deleting, setDeleting] = useState<LibraryEntry | null>(null);
  async function act(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '浏览器操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Content>
        <Dialog.Title>浏览器资料</Dialog.Title>
        <Dialog.Description>
          只在搜索时请求权限，最多显示 50 条；加入草稿的是你选中的链接，不会读取整段浏览历史。
        </Dialog.Description>
        <div {...stylex.props(styles.controls)}>
          <Button
            size="small"
            variant="ghost"
            disabled={busy}
            aria-pressed={kind === 'bookmarks'}
            onClick={() => {
              setKind('bookmarks');
              setEntries([]);
              setNotice('');
            }}
          >
            书签
          </Button>
          <Button
            size="small"
            variant="ghost"
            disabled={busy}
            aria-pressed={kind === 'history'}
            onClick={() => {
              setKind('history');
              setEntries([]);
              setNotice('');
            }}
          >
            浏览历史
          </Button>
        </div>
        <div {...stylex.props(styles.fields)}>
          <Input
            aria-label="搜索书签或历史"
            placeholder="标题或网址"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Input
            aria-label="限定域名"
            placeholder="限定域名（可选）"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
          {kind === 'history' && (
            <Field.Root>
              <Field.Label>最近天数（1–30）</Field.Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
              />
            </Field.Root>
          )}
        </div>
        <div {...stylex.props(styles.controls)}>
          <Button
            size="small"
            disabled={busy || !query.trim()}
            onClick={() =>
              void act(async () => {
                const rows = await searchLibrary(kind, query, days, domain);
                setEntries(rows);
                setNotice(rows.length ? `找到 ${rows.length} 条结果` : '没有找到匹配资料');
              })
            }
          >
            {busy ? '正在查询…' : '搜索并授权'}
          </Button>
          <Button
            size="small"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await revokeLibraryAccess(kind);
                setEntries([]);
                setNotice('已撤销浏览器访问权限。');
              })
            }
          >
            撤销权限
          </Button>
          {kind === 'bookmarks' && (
            <Button size="small" variant="ghost" disabled={busy} onClick={() => setCreate(!create)}>
              新增书签
            </Button>
          )}
        </div>
        {create && kind === 'bookmarks' && (
          <div {...stylex.props(styles.fields)}>
            <Input
              aria-label="新书签名称"
              placeholder="书签名称"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Input
              aria-label="新书签地址"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <p {...stylex.props(styles.detail)}>确认后将把以上名称和地址保存到浏览器书签。</p>
            <Button
              size="small"
              disabled={busy || !title.trim() || !url.trim()}
              onClick={() =>
                void act(async () => {
                  const entry = await addBookmark(title, url);
                  setEntries((current) => [entry, ...current]);
                  setCreate(false);
                  setNotice('书签已创建。');
                })
              }
            >
              确认创建书签
            </Button>
          </div>
        )}
        <div {...stylex.props(styles.list)}>
          {entries.map((entry) => (
            <div key={entry.id} {...stylex.props(styles.row)}>
              <div {...stylex.props(styles.text)}>
                {entry.title}
                <p {...stylex.props(styles.detail)}>{new URL(entry.url).hostname}</p>
              </div>
              <Button
                size="small"
                variant="ghost"
                disabled={busy}
                aria-label={`附加 ${entry.title}`}
                onClick={() =>
                  void act(async () => {
                    await onAdd(libraryContext(entry));
                    setNotice(`已附加 ${entry.title}`);
                  })
                }
              >
                附加
              </Button>
              {kind === 'bookmarks' && (
                <Button
                  size="small"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`移动书签 ${entry.title}`}
                  onClick={() =>
                    void act(async () => {
                      setFolders(await listBookmarkFolders());
                      setFolderId('');
                      setMoving(entry);
                    })
                  }
                >
                  移动
                </Button>
              )}
              {kind === 'bookmarks' && (
                <Button
                  size="small"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`删除书签 ${entry.title}`}
                  onClick={() => setDeleting(entry)}
                >
                  删除
                </Button>
              )}
            </div>
          ))}
        </div>
        {moving && (
          <div {...stylex.props(styles.fields)}>
            <p {...stylex.props(styles.detail)}>移动书签“{moving.title}”到：</p>
            <Select.Root
              value={folderId}
              onValueChange={(next) => {
                if (next !== null) setFolderId(next);
              }}
            >
              <Select.Trigger aria-label="目标书签文件夹">
                <Select.Value placeholder="选择文件夹" />
              </Select.Trigger>
              <Select.Content>
                {folders.map((folder) => (
                  <Select.Item key={folder.id} value={folder.id}>
                    {folder.title}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <div {...stylex.props(styles.controls)}>
              <Button size="small" variant="ghost" disabled={busy} onClick={() => setMoving(null)}>
                取消移动
              </Button>
              <Button
                size="small"
                disabled={busy || !folderId}
                onClick={() =>
                  void act(async () => {
                    await moveBookmark(moving, folderId);
                    setMoving(null);
                    setNotice('书签已移动。');
                  })
                }
              >
                确认移动
              </Button>
            </div>
          </div>
        )}
        {deleting && (
          <div {...stylex.props(styles.fields)}>
            <p {...stylex.props(styles.detail)}>
              确认删除书签“{deleting.title}”？此操作会修改浏览器中的书签。
            </p>
            <div {...stylex.props(styles.controls)}>
              <Button
                size="small"
                variant="ghost"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                保留
              </Button>
              <Button
                size="small"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await deleteBookmark(deleting);
                    setEntries((current) => current.filter((entry) => entry.id !== deleting.id));
                    setDeleting(null);
                    setNotice('书签已删除。');
                  })
                }
              >
                确认删除
              </Button>
            </div>
          </div>
        )}
        {notice && <output {...stylex.props(styles.detail)}>{notice}</output>}
        {error && (
          <p role="alert" {...stylex.props(styles.detail)}>
            {error}
          </p>
        )}
        <Dialog.Footer>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            关闭
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
