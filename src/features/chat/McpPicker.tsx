import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { Alert, Button, Input, Switch } from '../../shared/ui';
import { ActivityStatus } from '../../shared/ui/ActivityStatus';
import { Dialog } from '../../shared/ui/dialog';
import type { LodyClient } from '../connection/client';

const styles = stylex.create({
  list: { display: 'grid', gap: 12, overflowY: 'auto', maxHeight: '45dvh' },
  row: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
  label: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' },
  detail: { margin: '4px 0 0', fontSize: 12 },
});
export function McpPicker({
  client,
  selected,
  onApply,
  onClose,
}: {
  client: LodyClient;
  selected?: string[] | undefined;
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [servers, setServers] = useState<Awaited<ReturnType<LodyClient['listMcpServers']>>>([]);
  const [ids, setIds] = useState<string[]>(selected ?? []);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    let live = true;
    void client
      .listMcpServers()
      .then((rows) => {
        if (!live) return;
        setServers(rows);
        setIds(
          selected ??
            rows.filter((row) => row.enabledByDefault && row.hasConnection).map((row) => row.id),
        );
      })
      .catch((reason: Error) => {
        if (live) setError(reason.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [client, selected]);
  const missing = ids.filter((id) => !servers.some((row) => row.id === id && row.hasConnection));
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content>
        <Dialog.Title>工作区连接器</Dialog.Title>
        <Dialog.Description>
          选择本次消息交给 Agent 的 MCP
          服务。实际连接与工具支持由运行机器确认，配置存在不表示已经连接成功。
        </Dialog.Description>
        <Input
          aria-label="搜索连接器"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索 MCP 服务…"
        />
        {busy && <ActivityStatus busy>读取工作区连接器</ActivityStatus>}
        {error && (
          <Alert.Root tone="danger">
            <Alert.Description>{error}</Alert.Description>
          </Alert.Root>
        )}
        {!!missing.length && (
          <Alert.Root tone="warning">
            <Alert.Description>
              之前选择的服务已不可用：{missing.join('、')}。请清除选择后重新确认。
            </Alert.Description>
            <Alert.Actions>
              <Button onClick={() => setIds(ids.filter((id) => !missing.includes(id)))}>
                移除失效选择
              </Button>
            </Alert.Actions>
          </Alert.Root>
        )}
        <div {...stylex.props(styles.list)}>
          {servers
            .filter((row) =>
              `${row.name} ${row.description ?? ''}`
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            )
            .map((row) => (
              <div key={row.id} {...stylex.props(styles.row)}>
                <div {...stylex.props(styles.label)}>
                  {row.name}
                  <p {...stylex.props(styles.detail)}>{row.description}</p>
                  <p {...stylex.props(styles.detail)}>
                    {row.transport} ·{' '}
                    {row.hasConnection ? '已有连接配置，运行时验证' : '缺少连接配置'}
                  </p>
                </div>
                <Switch
                  aria-label={row.name}
                  checked={ids.includes(row.id)}
                  disabled={!row.hasConnection && !ids.includes(row.id)}
                  onCheckedChange={(checked) =>
                    setIds((current) =>
                      checked ? [...current, row.id] : current.filter((id) => id !== row.id),
                    )
                  }
                />
              </div>
            ))}
        </div>
        {!busy && !error && !servers.length && (
          <p>工作区尚未配置 MCP 服务。可在 Lody 的工作区设置中管理。</p>
        )}
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="secondary" disabled={busy || !!error} onClick={() => setIds([])}>
            本次不使用
          </Button>
          <Button
            disabled={busy || !!error || !!missing.length}
            onClick={() => {
              onApply(ids);
              onClose();
            }}
          >
            应用到本次消息
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
