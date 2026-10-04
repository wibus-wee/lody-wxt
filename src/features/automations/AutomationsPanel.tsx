import type { ScheduleDocument, ScheduleRegistryRow, ScheduleRuntimeRow } from '@lody-mobile/sdk';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { Icon } from '../../shared/icons/Icon';
import { Button } from '../../shared/ui';
import { Dialog } from '../../shared/ui/dialog';
import type { ComposerMentionRange } from '../chat/mentions/types';
import type { ExecutionTarget, LodyClient } from '../connection/client';
import type { ScheduleOperation } from './journal';
import { loadScheduleOperation, resumeScheduleOperation, stageScheduleOperation } from './journal';
import { PromptShortcutsPanel } from './PromptShortcutsPanel';
import { ScheduleEditor } from './ScheduleEditor';
import { automationScope } from './storage';
import { automationStyles as styles, scheduleCard } from './styles';

interface AutomationsPanelProps {
  client: Pick<
    LodyClient,
    | 'subscribe'
    | 'getSnapshot'
    | 'schedules'
    | 'accountKey'
    | 'shortcuts'
    | 'shortcutContext'
    | 'listSkills'
  >;
  accountId: string;
  workspaceId: string;
  target: ExecutionTarget | null;
  targetControl?: ReactNode;
  initialPrompt?: string;
  initialSearch?: string;
  onUseWorkflow: (workflow: {
    prompt: string;
    includeCurrentPage: boolean;
    mentions?: readonly ComposerMentionRange[];
  }) => void | Promise<void>;
  onOpenSession?: (id: string) => void;
  onClose: () => void;
}
type Editor = { kind: 'schedule'; document: ScheduleDocument | null } | null;
function ScopedAutomations({ scope, ...props }: AutomationsPanelProps & { scope: string }) {
  const snapshot = useSyncExternalStore(props.client.subscribe, props.client.getSnapshot);
  const [schedules, setSchedules] = useState<ScheduleRegistryRow[]>([]);
  const [runtimes, setRuntimes] = useState<ScheduleRuntimeRow[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [pending, setPending] = useState<ScheduleOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<{
    kind: 'schedule';
    id: string;
    title: string;
  } | null>(null);
  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      props.client.schedules.list(),
      props.client.schedules.runtimeRows(),
      loadScheduleOperation(scope),
    ]);
    const [registry, runtime, journal] = results;
    if (registry.status === 'fulfilled')
      setSchedules(registry.value.toSorted((a, b) => b.updatedAt - a.updatedAt));
    if (runtime.status === 'fulfilled') setRuntimes(runtime.value);
    if (journal.status === 'fulfilled') setPending(journal.value);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected')
      setError(failure.reason instanceof Error ? failure.reason.message : String(failure.reason));
  }, [scope, props.client]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    const interval = setInterval(() => void refresh(), 15000);
    return () => clearInterval(interval);
  }, [refresh]);
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  const mutate = async (operation: ScheduleOperation) => {
    if (snapshot.status !== 'connected') throw new Error('请先连接工作区，再修改定时任务。');
    await stageScheduleOperation(scope, operation);
    setPending(operation);
    await resumeScheduleOperation(scope, props.client.schedules);
    setPending(null);
  };
  const cloudDisabled = busy || !!pending || snapshot.status !== 'connected';
  const newSchedule = () => setEditor({ kind: 'schedule', document: null });
  return (
    <section {...stylex.props(styles.page)} aria-label="快捷指令与定时任务">
      <header {...stylex.props(styles.header)}>
        <Button
          variant="ghost"
          size="small"
          icon
          aria-label={editor ? '返回自动化列表' : '返回对话'}
          disabled={busy}
          onClick={() => (editor ? setEditor(null) : props.onClose())}
        >
          <Icon name="back" size={18} />
        </Button>
        <h2 {...stylex.props(styles.heading)}>{editor ? '定时任务' : '快捷指令与定时任务'}</h2>
        {!editor && (
          <Button
            variant="ghost"
            size="small"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await Promise.all([refresh(), props.client.shortcuts.retry()]);
              })
            }
          >
            刷新
          </Button>
        )}
      </header>
      <div {...stylex.props(styles.body)}>
        {error && editor?.kind !== 'schedule' && (
          <output role="alert" {...stylex.props(styles.hint)}>
            {error}
          </output>
        )}
        {notice && <output {...stylex.props(styles.hint)}>{notice}</output>}
        {pending && (
          <div {...stylex.props(scheduleCard, styles.card)}>
            <p {...stylex.props(styles.hint)}>
              上一次定时任务操作尚待确认。恢复会沿用原请求，不会新建第二次运行。
            </p>
            <Button
              size="small"
              disabled={busy || snapshot.status !== 'connected'}
              onClick={() =>
                void perform(async () => {
                  await resumeScheduleOperation(scope, props.client.schedules);
                  setPending(null);
                  setNotice('操作已同步。');
                })
              }
            >
              恢复上次操作
            </Button>
          </div>
        )}
        {editor?.kind === 'schedule' ? (
          <ScheduleEditor
            key={editor.document?.definition.scheduleId ?? 'new'}
            document={editor.document}
            externalError={error}
            target={props.target}
            snapshot={snapshot}
            targetControl={props.targetControl}
            busy={busy}
            disabled={cloudDisabled}
            onSave={async (draft) => {
              setBusy(true);
              setError('');
              try {
                await mutate({
                  kind: 'save',
                  input: {
                    scheduleId: editor.document?.definition.scheduleId ?? crypto.randomUUID(),
                    draft,
                    now: Date.now(),
                    activationId: crypto.randomUUID(),
                    activityId: crypto.randomUUID(),
                    create: !editor.document,
                  },
                });
                setEditor(null);
                setNotice('定时任务已同步；运行状态由机器报告。');
              } finally {
                setBusy(false);
                await refresh();
              }
            }}
          />
        ) : (
          <>
            <PromptShortcutsPanel
              client={props.client}
              scope={scope}
              {...(props.initialPrompt !== undefined ? { initialPrompt: props.initialPrompt } : {})}
              {...(props.initialSearch !== undefined ? { initialSearch: props.initialSearch } : {})}
              onUse={props.onUseWorkflow}
            />
            <section {...stylex.props(styles.section)}>
              <div {...stylex.props(styles.row)}>
                <h3 {...stylex.props(styles.title, styles.grow)}>定时任务</h3>
                <Button size="small" variant="ghost" disabled={cloudDisabled} onClick={newSchedule}>
                  <Icon name="plus" size={14} />
                  新建
                </Button>
              </div>
              {snapshot.status !== 'connected' && (
                <p {...stylex.props(styles.hint)}>连接工作区后读取和修改定时任务。</p>
              )}
              {!schedules.length && (
                <p {...stylex.props(styles.hint)}>
                  任务由所选运行机器执行，浏览器关闭后仍由该机器负责。
                </p>
              )}
              {schedules.map((row) => {
                const runtime = runtimes.find(
                  (item) =>
                    item.scheduleId === row.scheduleId &&
                    item.machineId === row.machineId &&
                    item.activationId === row.activationId &&
                    item.observedDefinitionFingerprint === row.definitionFingerprint,
                );
                const machine = snapshot.machines.find((item) => item.id === row.machineId);
                const rowDisabled = cloudDisabled || row.ownerId !== props.accountId;
                return (
                  <div key={row.scheduleId} {...stylex.props(scheduleCard, styles.card)}>
                    <div {...stylex.props(styles.row)}>
                      <h4 {...stylex.props(styles.title, styles.grow)}>{row.title}</h4>
                      <span {...stylex.props(styles.hint)}>
                        {row.enabled ? '已启用' : '已暂停'}
                      </span>
                    </div>
                    <p {...stylex.props(styles.hint)}>
                      {machine?.name ?? row.machineId}
                      {machine?.status === 'offline' ? ' · 机器离线' : ''}
                    </p>
                    <p {...stylex.props(styles.hint)}>
                      {!row.enabled
                        ? '暂停期间不安排新运行'
                        : row.trigger.kind === 'manual'
                          ? '按需手动运行'
                          : runtime?.nextScheduledAt
                            ? `下次运行：${new Date(runtime.nextScheduledAt).toLocaleString()}`
                            : '等待机器确认下次运行'}
                    </p>
                    {runtime?.queueState && (
                      <p {...stylex.props(styles.hint)}>
                        运行状态：
                        {
                          {
                            due: '等待运行',
                            waiting_for_agent: '等待助手',
                            retrying: '正在重试',
                            blocked: '已阻塞',
                          }[runtime.queueState]
                        }
                        {runtime.blockedCode ? ` · ${runtime.blockedCode}` : ''}
                      </p>
                    )}
                    {runtime?.lastDispatch && (
                      <p {...stylex.props(styles.hint)}>
                        最近派发：{new Date(runtime.lastDispatch.dispatchedAt).toLocaleString()} ·
                        结果见对应会话
                      </p>
                    )}
                    <div {...stylex.props(styles.row, styles.wrap)}>
                      <Button
                        size="small"
                        variant="ghost"
                        disabled={rowDisabled}
                        onClick={() =>
                          void perform(async () => {
                            const document = await props.client.schedules.read(row.scheduleId);
                            if (!document) throw new Error('任务已不存在，请刷新列表。');
                            setEditor({ kind: 'schedule', document });
                          })
                        }
                      >
                        编辑
                      </Button>
                      <Button
                        size="small"
                        variant="ghost"
                        disabled={rowDisabled || !machine?.schedules}
                        onClick={() =>
                          void perform(async () => {
                            await mutate({
                              kind: 'run',
                              input: {
                                scheduleId: row.scheduleId,
                                manualRunId: crypto.randomUUID(),
                                now: Date.now(),
                              },
                            });
                            setNotice('运行请求已同步，等待机器派发。');
                          })
                        }
                      >
                        运行一次
                      </Button>
                      <Button
                        size="small"
                        variant="ghost"
                        disabled={rowDisabled}
                        onClick={() =>
                          void perform(async () => {
                            await mutate({
                              kind: 'enable',
                              input: {
                                scheduleId: row.scheduleId,
                                enabled: !row.enabled,
                                now: Date.now(),
                                activationId: crypto.randomUUID(),
                                requestId: crypto.randomUUID(),
                              },
                            });
                          })
                        }
                      >
                        {row.enabled ? '暂停' : '恢复'}
                      </Button>
                      {runtime?.lastDispatch && props.onOpenSession && (
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={() => props.onOpenSession?.(runtime.lastDispatch!.sessionId)}
                        >
                          查看结果
                        </Button>
                      )}
                      <Button
                        size="small"
                        variant="ghost"
                        disabled={rowDisabled}
                        onClick={() =>
                          setConfirm({ kind: 'schedule', id: row.scheduleId, title: row.title })
                        }
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                );
              })}
            </section>
          </>
        )}
      </div>
      <Dialog.Root
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
      >
        <Dialog.Content closeLabel="取消删除">
          <Dialog.Title>删除定时任务</Dialog.Title>
          <Dialog.Description>确定删除“{confirm?.title}”？此操作无法撤销。</Dialog.Description>
          <Dialog.Footer>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  if (!confirm) return;
                  await mutate({ kind: 'delete', input: { scheduleId: confirm.id } });
                  setConfirm(null);
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
export function AutomationsPanel(props: AutomationsPanelProps) {
  const scope = automationScope(props.client.accountKey, props.workspaceId);
  return <ScopedAutomations key={scope} {...props} scope={scope} />;
}
