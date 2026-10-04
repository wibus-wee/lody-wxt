import type { PromptShortcut, PromptShortcutIndexEntry } from '@lody-mobile/sdk';
import { parsePromptShortcut } from '@lody-mobile/sdk';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Icon } from '../../shared/icons/Icon';
import { Button, Field, Input, Switch, Textarea } from '../../shared/ui';
import { ActivityStatus } from '../../shared/ui/ActivityStatus';
import { Dialog } from '../../shared/ui/dialog';
import type { ComposerMentionRange } from '../chat/mentions/types';
import type { ShortcutClient } from './prompt-shortcut-source';
import { preparePromptShortcut } from './prompt-shortcut-source';
import { migrateWorkflows, migrationStatus } from './shortcut-migration';
import { automationStyles as styles, scheduleCard } from './styles';

interface ShortcutDraft {
  value: PromptShortcut;
  base: PromptShortcutIndexEntry | null;
  bodyDocId: string;
}
// Rejections and the runtime error map contain open error values; render their diagnostic without treating them as shortcut data.
// ast-grep-ignore: no-unknown-parameter
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function ShortcutEditor({
  draft,
  busy,
  onSave,
  onCancel,
}: {
  draft: ShortcutDraft;
  busy: boolean;
  onSave: (draft: ShortcutDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(draft.value);
  const [error, setError] = useState('');
  return (
    <form
      {...stylex.props(styles.editor)}
      onSubmit={(event) => {
        event.preventDefault();
        setError('');
        void Promise.resolve()
          .then(() => onSave({ ...draft, value: parsePromptShortcut(value) }))
          .catch((failure) => setError(message(failure)));
      }}
    >
      <Field.Root disabled={busy}>
        <Field.Label>名称</Field.Label>
        <Input
          aria-label="快捷指令名称"
          required
          maxLength={60}
          value={value.name}
          onChange={(event) => setValue({ ...value, name: event.target.value })}
        />
      </Field.Root>
      <Field.Root disabled={busy}>
        <Field.Label>命令</Field.Label>
        <Input
          aria-label="快捷指令命令"
          required
          maxLength={40}
          pattern="[a-z0-9][a-z0-9-]{0,39}"
          value={value.slug}
          leading="/"
          onChange={(event) => setValue({ ...value, slug: event.target.value })}
        />
        <p {...stylex.props(styles.hint)}>使用小写字母、数字或连字符，在输入框输入 / 即可查找。</p>
      </Field.Root>
      <Field.Root disabled={busy}>
        <Field.Label>说明</Field.Label>
        <Input
          aria-label="说明"
          maxLength={240}
          value={value.description ?? ''}
          onChange={(event) => setValue({ ...value, description: event.target.value })}
        />
      </Field.Root>
      <Field.Root disabled={busy}>
        <Field.Label>提示词</Field.Label>
        <Textarea
          aria-label="快捷指令提示词"
          required
          resize="none"
          value={value.prompt}
          readOnly={value.mentions.length > 0}
          onChange={(event) => setValue({ ...value, prompt: event.target.value })}
          {...stylex.props(styles.prompt)}
        />
        {value.mentions.length > 0 && (
          <p {...stylex.props(styles.hint)}>
            此提示词含结构化引用，请在 Lody
            中修改正文。名称、命令和共享设置可以在这里编辑；引用与适用范围会完整保留。
          </p>
        )}
      </Field.Root>
      <div {...stylex.props(styles.property)}>
        <span>与工作区共享</span>
        <div {...stylex.props(styles.value)}>
          <Switch
            aria-label="与工作区共享"
            checked={value.visibility === 'workspace'}
            disabled={busy}
            onCheckedChange={(checked) =>
              setValue({ ...value, visibility: checked ? 'workspace' : 'private' })
            }
          />
        </div>
      </div>
      <p {...stylex.props(styles.hint)}>
        {value.visibility === 'workspace'
          ? '工作区成员可以读取、使用和复制此提示词及引用。之后改为私有，也无法撤回他们已收到的副本。'
          : '仅你可以读取和使用此提示词。'}
      </p>
      {error && (
        <output role="alert" {...stylex.props(styles.hint)}>
          {error}
        </output>
      )}
      <div {...stylex.props(styles.row)}>
        <Button type="submit" disabled={busy}>
          保存快捷指令
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

export function PromptShortcutsPanel({
  client,
  scope,
  initialPrompt,
  initialSearch,
  onUse,
}: {
  client: ShortcutClient;
  scope: string;
  initialPrompt?: string;
  initialSearch?: string;
  onUse: (value: {
    prompt: string;
    includeCurrentPage: boolean;
    mentions?: readonly ComposerMentionRange[];
  }) => void | Promise<void>;
}) {
  const snapshot = useSyncExternalStore(client.shortcuts.subscribe, client.shortcuts.getSnapshot);
  const [search, setSearch] = useState(initialSearch ?? '');
  const [editor, setEditor] = useState<ShortcutDraft | null>(null);
  const [deleting, setDeleting] = useState<PromptShortcutIndexEntry | null>(null);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [legacy, setLegacy] = useState<Awaited<ReturnType<typeof migrationStatus>>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const actionRef = useRef(false);
  const lifetimeRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetimeRef.current = controller;
    void client.shortcuts.connect().catch((failure) => {
      if (!controller.signal.aborted) setError(message(failure));
    });
    return () => controller.abort();
  }, [client]);
  useEffect(() => {
    let active = true;
    void migrationStatus(scope, client.shortcuts)
      .then((rows) => {
        if (active) setLegacy(rows);
      })
      .catch((failure) => {
        if (active) setError(message(failure));
      });
    return () => {
      active = false;
    };
  }, [scope, client, snapshot]);
  const run = async (operation: () => Promise<void>, propagate = false) => {
    if (actionRef.current) return;
    actionRef.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (failure) {
      setError(message(failure));
      if (propagate) throw failure;
    } finally {
      actionRef.current = false;
      setBusy(false);
    }
  };
  const context = client.shortcutContext();
  const newDraft = () => {
    const now = Date.now();
    setEditor({
      base: null,
      bodyDocId: crypto.randomUUID(),
      value: {
        v: 1,
        id: crypto.randomUUID(),
        workspaceId: context.workspaceId,
        ownerUserId: context.userId,
        visibility: 'private',
        name: '',
        slug: '',
        prompt: initialPrompt ?? '',
        mentions: [],
        scope: {},
        revision: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      },
    });
  };
  const entries = snapshot.entries.filter(
    (entry) =>
      entry.workspaceId === context.workspaceId &&
      (entry.visibility === 'workspace' || entry.ownerUserId === context.userId) &&
      `${entry.name} ${entry.slug} ${entry.description ?? ''}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const syncErrors = Object.values(snapshot.errors).map(message);
  const unmigrated = legacy.filter((row) => row.state !== 'synced');
  return (
    <section {...stylex.props(styles.section)} aria-label="同步快捷指令">
      <div {...stylex.props(styles.row)}>
        <h3 {...stylex.props(styles.title, styles.grow)}>{editor ? '编辑快捷指令' : '快捷指令'}</h3>
        {!editor && (
          <Button
            size="small"
            variant="ghost"
            disabled={busy || snapshot.loading}
            onClick={newDraft}
          >
            <Icon name="plus" size={14} />
            新建
          </Button>
        )}
      </div>
      <p {...stylex.props(styles.hint)}>
        与 Lody 同步。在输入框输入 / 使用快捷指令，填入草稿后再发送。
      </p>
      {error && (
        <output role="alert" {...stylex.props(styles.hint)}>
          {error}
        </output>
      )}
      {syncErrors.length > 0 && (
        <output role="alert" {...stylex.props(styles.hint)}>
          {syncErrors.join('；')}
        </output>
      )}
      {(error || syncErrors.length > 0) && (
        <Button
          size="small"
          variant="ghost"
          disabled={busy}
          onClick={() => void run(() => client.shortcuts.retry())}
        >
          重新同步
        </Button>
      )}
      {snapshot.loading && <ActivityStatus busy>读取快捷指令</ActivityStatus>}
      {snapshot.pendingIds.some((id) => !snapshot.entries.some((entry) => entry.id === id)) && (
        <ActivityStatus busy={syncErrors.length === 0}>删除待同步</ActivityStatus>
      )}
      {editor ? (
        <ShortcutEditor
          key={editor.value.revision}
          draft={editor}
          busy={busy}
          onCancel={() => setEditor(null)}
          onSave={(draft) =>
            run(async () => {
              await client.shortcuts.save({
                ...draft,
                bodyDocId:
                  draft.base && draft.base.visibility === draft.value.visibility
                    ? draft.base.bodyDocId
                    : draft.bodyDocId,
              });
              setEditor(null);
            }, true)
          }
        />
      ) : (
        <>
          <Input
            aria-label="搜索快捷指令"
            placeholder="搜索名称或命令…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {!snapshot.loading && entries.length === 0 && (
            <p {...stylex.props(styles.hint)}>
              {search ? '没有匹配的快捷指令。' : '保存常用提示词，在 Lody 和浏览器里使用。'}
            </p>
          )}
          {entries.map((entry) => {
            const owned = entry.ownerUserId === context.userId;
            const pending = snapshot.pendingIds.includes(entry.id);
            return (
              <section
                key={entry.id}
                aria-label={`快捷指令 ${entry.name}`}
                {...stylex.props(scheduleCard, styles.card)}
              >
                <div {...stylex.props(styles.row)}>
                  <h4 {...stylex.props(styles.title, styles.grow)}>{entry.name}</h4>
                  <span {...stylex.props(styles.hint)}>/{entry.slug}</span>
                </div>
                <p {...stylex.props(styles.hint)}>
                  {entry.visibility === 'private' ? '私有' : '工作区共享'}
                  {pending ? ' · 等待同步' : ''}
                  {entry.description ? ` · ${entry.description}` : ''}
                </p>
                <div {...stylex.props(styles.row, styles.wrap)}>
                  <Button
                    size="small"
                    disabled={busy || pending}
                    onClick={() =>
                      void run(async () => {
                        const controller = lifetimeRef.current;
                        if (!controller) return;
                        const prepared = await preparePromptShortcut(
                          client,
                          entry,
                          controller.signal,
                        );
                        controller.signal.throwIfAborted();
                        await onUse({
                          prompt: prepared.text,
                          includeCurrentPage: false,
                          ...(prepared.ranges ? { mentions: prepared.ranges } : {}),
                        });
                      })
                    }
                  >
                    使用
                  </Button>
                  {owned && (
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={busy || pending}
                      onClick={() =>
                        void run(async () => {
                          const value = await client.shortcuts.read(entry);
                          lifetimeRef.current?.signal.throwIfAborted();
                          setEditor({
                            value: {
                              ...value,
                              revision: crypto.randomUUID(),
                              updatedAt: Date.now(),
                            },
                            base: entry,
                            bodyDocId: crypto.randomUUID(),
                          });
                        })
                      }
                    >
                      编辑
                    </Button>
                  )}
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={busy || pending}
                    onClick={() =>
                      void run(async () => {
                        const value = await client.shortcuts.read(entry);
                        lifetimeRef.current?.signal.throwIfAborted();
                        const now = Date.now();
                        setEditor({
                          base: null,
                          bodyDocId: crypto.randomUUID(),
                          value: {
                            ...value,
                            id: crypto.randomUUID(),
                            ownerUserId: context.userId,
                            visibility: 'private',
                            name: `${value.name.slice(0, 57)} 副本`,
                            slug: `${value.slug.slice(0, 30)}-copy`,
                            revision: crypto.randomUUID(),
                            createdAt: now,
                            updatedAt: now,
                          },
                        });
                      })
                    }
                  >
                    复制
                  </Button>
                  {owned && (
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={busy || pending}
                      onClick={() => setDeleting(entry)}
                    >
                      删除
                    </Button>
                  )}
                </div>
              </section>
            );
          })}
        </>
      )}
      {legacy.length > 0 && (
        <section aria-label="本地快捷指令迁移" {...stylex.props(scheduleCard, styles.card)}>
          <h4 {...stylex.props(styles.title)}>本地快捷指令</h4>
          {legacy.map((row) => (
            <p key={row.workflow.id} {...stylex.props(styles.hint)}>
              {row.workflow.title} ·{' '}
              {row.state === 'synced'
                ? '已迁移，原件保留'
                : row.state === 'pending'
                  ? '迁移待同步'
                  : '仅此浏览器'}
            </p>
          ))}
          {unmigrated.length > 0 && (
            <Button
              size="small"
              variant="ghost"
              disabled={busy || snapshot.loading}
              onClick={() => setMigrationOpen(true)}
            >
              迁移到 Lody
            </Button>
          )}
        </section>
      )}
      <Dialog.Root
        open={migrationOpen}
        onOpenChange={(open) => {
          if (!busy) setMigrationOpen(open);
        }}
      >
        <Dialog.Content closeLabel="取消迁移">
          <Dialog.Title>迁移本地快捷指令</Dialog.Title>
          <Dialog.Description>
            以下内容将上传为你的私有快捷指令，保留浏览器中的原件。参数占位符作为原文保留；附加页面改为发送前手动选择。超过
            60 字的名称会缩短，完整名称保存在说明中。
          </Dialog.Description>
          <div {...stylex.props(styles.section)}>
            {unmigrated.map(({ workflow }) => (
              <section key={workflow.id} {...stylex.props(scheduleCard, styles.card)}>
                <h4 {...stylex.props(styles.title)}>{workflow.title}</h4>
                <p {...stylex.props(styles.hint)}>{workflow.prompt}</p>
              </section>
            ))}
          </div>
          <Dialog.Footer>
            <Button variant="ghost" disabled={busy} onClick={() => setMigrationOpen(false)}>
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await migrateWorkflows({
                    scope,
                    shortcuts: client.shortcuts,
                    workspaceId: context.workspaceId,
                    userId: context.userId,
                    workflows: unmigrated.map((row) => row.workflow),
                  });
                  setLegacy(await migrationStatus(scope, client.shortcuts));
                  setMigrationOpen(false);
                })
              }
            >
              确认迁移
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <Dialog.Content closeLabel="取消删除">
          <Dialog.Title>删除快捷指令</Dialog.Title>
          <Dialog.Description>确定删除“{deleting?.name}”？删除会同步到 Lody。</Dialog.Description>
          <Dialog.Footer>
            <Button variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (deleting) await client.shortcuts.remove(deleting);
                  setDeleting(null);
                })
              }
            >
              删除
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </section>
  );
}
