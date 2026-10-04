import { colors } from '@lody/ui/tokens/colors.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { Button, Input, Spinner, Switch } from '../../shared/ui';
import { Dialog } from '../../shared/ui/dialog';
import type { ContextTab } from './capture';
import { capturePage, listContextTabs } from './capture';
import type { PageContext } from './model';

const styles = stylex.create({
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxHeight: '45vh',
    overflowY: 'auto',
    marginBlock: 12,
  },
  row: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  text: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' },
  title: { fontSize: 13, margin: 0 },
  detail: { fontSize: 12, margin: '4px 0 0', color: colors.secondaryLabel },
  error: { fontSize: 13, overflowWrap: 'anywhere' },
});

export function TabContextPicker({
  onAdd,
  onClose,
  maxRemaining,
  load = listContextTabs,
  capture = capturePage,
}: {
  onAdd: (context: PageContext) => void | Promise<void>;
  onClose: () => void;
  maxRemaining: number;
  load?: () => Promise<ContextTab[]>;
  capture?: typeof capturePage;
}) {
  const [tabs, setTabs] = useState<ContextTab[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [states, setStates] = useState<Record<number, string>>({});
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void load()
      .then((value) => {
        if (live) setTabs(value);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : '标签页加载失败。');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [load]);
  async function attach() {
    setBusy(true);
    let added = 0;
    for (const id of selected.slice(0, maxRemaining)) {
      const tab = tabs.find((value) => value.id === id);
      if (!tab) continue;
      setStates((current) => ({ ...current, [id]: '正在读取…' }));
      try {
        await onAdd(await capture('page', { tabId: id, expectedUrl: tab.url }));
        added++;
        setStates((current) => ({ ...current, [id]: '已附加' }));
        setSelected((current) => current.filter((value) => value !== id));
      } catch (cause) {
        setStates((current) => ({
          ...current,
          [id]: cause instanceof Error ? cause.message : '读取失败，请重试。',
        }));
      }
    }
    setBusy(false);
    if (added === selected.length) onClose();
  }
  const matches = tabs.filter((tab) =>
    `${tab.title} ${tab.url}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Content>
        <Dialog.Title>附加标签页</Dialog.Title>
        <Dialog.Description>
          仅在你点击附加后读取所选页面。还可附加 {maxRemaining} 份资料。
        </Dialog.Description>
        <Input
          aria-label="搜索标签页标题或网址"
          placeholder="搜索标签页"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {loading && <Spinner size="small" label="正在查找标签页" />}
        {error && (
          <p role="alert" {...stylex.props(styles.error)}>
            {error}
          </p>
        )}
        <div {...stylex.props(styles.list)}>
          {matches.map((tab) => (
            <div key={tab.id} {...stylex.props(styles.row)}>
              <Switch
                aria-label={`选择 ${tab.title}`}
                checked={selected.includes(tab.id)}
                disabled={
                  busy ||
                  states[tab.id] === '已附加' ||
                  (!selected.includes(tab.id) && selected.length >= maxRemaining)
                }
                onCheckedChange={(checked) =>
                  setSelected((current) =>
                    checked ? [...current, tab.id] : current.filter((id) => id !== tab.id),
                  )
                }
              />
              <div {...stylex.props(styles.text)}>
                <p {...stylex.props(styles.title)}>{tab.title}</p>
                <p {...stylex.props(styles.detail)}>{new URL(tab.url).hostname}</p>
                {states[tab.id] && (
                  <output {...stylex.props(styles.detail)}>{states[tab.id]}</output>
                )}
              </div>
            </div>
          ))}
          {!loading && !error && !matches.length && (
            <p {...stylex.props(styles.detail)}>没有匹配的网页。</p>
          )}
        </div>
        <Dialog.Footer>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            关闭
          </Button>
          <Button
            disabled={busy || !selected.length || !maxRemaining}
            onClick={() => void attach()}
          >
            {busy ? '正在附加…' : `附加 ${selected.length} 个页面`}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
