import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { Alert, Button, Input } from '../../shared/ui';
import { ActivityStatus } from '../../shared/ui/ActivityStatus';
import { Dialog } from '../../shared/ui/dialog';
import type { LodyClient } from '../connection/client';

const styles = stylex.create({
  list: { display: 'grid', gap: 8, maxHeight: '45dvh', overflowY: 'auto', minWidth: 0 },
  row: { display: 'grid', gap: 4, minWidth: 0 },
  detail: { fontSize: 12, overflowWrap: 'anywhere', margin: 0 },
});
export function SkillsPicker({
  client,
  onUse,
  onClose,
}: {
  client: LodyClient;
  onUse: (prompt: string) => void;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<Awaited<ReturnType<LodyClient['listSkills']>>>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let live = true;
    void client
      .listSkills()
      .then((result) => {
        if (live) setGroups(result);
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
  }, [client, generation]);
  const filtered = groups
    .flatMap((group) => group.skills.map((skill) => ({ ...skill, scope: group.scope })))
    .filter((skill) =>
      `${skill.name} ${skill.description ?? ''}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content>
        <Dialog.Title>可用技能</Dialog.Title>
        <Dialog.Description>
          读取当前机器的全局与系统技能。选择后加入草稿，由你确认发送；项目专属技能需要对应项目。
        </Dialog.Description>
        <Input
          aria-label="搜索技能"
          placeholder="搜索技能…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {busy && <ActivityStatus busy>读取技能</ActivityStatus>}
        {error && (
          <Alert.Root tone="danger">
            <Alert.Description>{error}</Alert.Description>
            <Alert.Actions>
              <Button
                size="small"
                onClick={() => {
                  setBusy(true);
                  setError('');
                  setGeneration((value) => value + 1);
                }}
              >
                重新读取
              </Button>
            </Alert.Actions>
          </Alert.Root>
        )}
        {groups
          .filter((group) => group.error || group.truncated)
          .map((group) => (
            <Alert.Root tone="warning" key={group.dir}>
              <Alert.Description>
                {group.dir}: {group.error ?? '只返回了部分技能。'}
              </Alert.Description>
            </Alert.Root>
          ))}
        <div {...stylex.props(styles.list)}>
          {filtered.map((skill) => (
            <div
              key={`${skill.scope}:${skill.id}:${skill.relativePath}`}
              {...stylex.props(styles.row)}
            >
              <Button
                size="small"
                variant="secondary"
                onClick={() => {
                  onUse(
                    `请使用技能「${skill.name}」（${skill.absolutePath ?? skill.relativePath}）处理下面的请求：\n`,
                  );
                  onClose();
                }}
              >
                {skill.name}
              </Button>
              <p {...stylex.props(styles.detail)}>{skill.description}</p>
            </div>
          ))}
        </div>
        {!busy && !error && !filtered.length && <p>没有找到匹配的技能。</p>}
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            返回对话
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
