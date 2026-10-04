import type { ScheduleDocument, ScheduleDraft, ScheduleProject } from '@lody-mobile/sdk';
import { previewSchedule } from '@lody-mobile/sdk';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { Button, Field, Input, Textarea } from '../../shared/ui';
import type { ClientSnapshot, ExecutionTarget } from '../connection/client';
import { ChoiceField } from '../conversations/ChoiceField';
import type { ScheduleRecurrence } from './recurrence';
import {
  applyScheduleRecurrence,
  defaultScheduleRecurrence,
  triggerToRecurrence,
} from './recurrence';
import { RecurrenceEditor } from './RecurrenceEditor';
import { automationStyles as styles, scheduleCard } from './styles';

function recurrenceTimeZone(recurrence: ScheduleRecurrence, fallback: string) {
  switch (recurrence.kind) {
    case 'once':
    case 'unsupported':
      return fallback;
    default:
      return recurrence.timeZone;
  }
}

function scheduleProject(target: ExecutionTarget): ScheduleProject | undefined {
  switch (target.project.kind) {
    case 'chat':
      return undefined;
    case 'local':
      return {
        kind: 'local',
        localProjectId: target.project.localProjectId,
        ...(target.project.branch ? { branch: target.project.branch } : {}),
      };
    case 'github':
      if (!target.project.branch) throw new Error('请为项目选择明确的分支。');
      return { kind: 'github', repoFullName: target.project.repo, branch: target.project.branch };
  }
}
export function ScheduleEditor({
  document,
  target,
  snapshot,
  targetControl,
  onSave,
  busy,
  disabled,
  externalError,
}: {
  document: ScheduleDocument | null;
  target: ExecutionTarget | null;
  snapshot: ClientSnapshot;
  targetControl?: ReactNode;
  onSave: (draft: ScheduleDraft) => Promise<void>;
  busy: boolean;
  disabled: boolean;
  externalError?: string;
}) {
  const original = document?.definition;
  const [title, setTitle] = useState(original?.title ?? '');
  const [prompt, setPrompt] = useState(document?.prompt ?? '');
  const [manual, setManual] = useState(original?.trigger.kind === 'manual');
  const [useCurrentTarget, setUseCurrentTarget] = useState(!original);
  const machineId = useCurrentTarget ? target?.machineId : original?.machineId;
  const machine = snapshot.machines.find((item) => item.id === machineId);
  const timeZone = machine?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [recurrence, setRecurrence] = useState(() =>
    original && original.trigger.kind !== 'manual'
      ? triggerToRecurrence(original.trigger)
      : defaultScheduleRecurrence(timeZone),
  );
  const effectiveRecurrence =
    useCurrentTarget && recurrence.kind !== 'once' && recurrence.kind !== 'unsupported'
      ? { ...recurrence, timeZone }
      : recurrence;
  const [destination, setDestination] = useState(
    original?.destination ?? { kind: 'new_session' as const },
  );
  const [misfire, setMisfire] = useState(original?.misfirePolicy.kind ?? 'skip');
  const [overlap, setOverlap] = useState(original?.overlapPolicy ?? 'skip');
  const [error, setError] = useState('');
  const [now] = useState(Date.now);
  let preview = '';
  try {
    const trigger = manual
      ? { kind: 'manual' as const }
      : applyScheduleRecurrence(effectiveRecurrence, now, original?.trigger);
    const next = previewSchedule(trigger, now, now, 1)[0];
    preview = next
      ? `预计下次：${new Date(next).toLocaleString()}（规则计算）`
      : manual
        ? '按需手动运行'
        : '规则没有后续运行时间';
  } catch (failure) {
    preview = failure instanceof Error ? failure.message : String(failure);
  }
  const save = async () => {
    setError('');
    try {
      if (!title.trim() || !prompt.trim()) throw new Error('请填写任务名称和提示词。');
      if (snapshot.status !== 'connected') throw new Error('工作区尚未连接，无法保存定时任务。');
      if (!machine?.schedules) throw new Error('当前机器未报告定时任务能力，请选择支持的机器。');
      const agent =
        useCurrentTarget && target ? { agentConfigId: target.agentConfigId } : original?.agent;
      if (!machineId || !agent) throw new Error('请选择运行机器和助手。');
      const project =
        destination.kind === 'new_session'
          ? useCurrentTarget && target
            ? scheduleProject(target)
            : original?.project
          : undefined;
      if (destination.kind === 'existing_session') {
        const session = snapshot.conversations.find((row) => row.id === destination.sessionId);
        if (
          !session ||
          session.target.machineId !== machineId ||
          session.target.agentConfigId !== agent.agentConfigId
        )
          throw new Error('目标对话必须属于所选机器和助手。');
      }
      await onSave({
        title: title.trim(),
        prompt: prompt.trim(),
        machineId,
        agent,
        destination,
        ...(project ? { project } : {}),
        trigger: manual
          ? { kind: 'manual' }
          : applyScheduleRecurrence(effectiveRecurrence, Date.now(), original?.trigger),
        misfirePolicy: { kind: misfire },
        overlapPolicy: overlap,
        retryPolicy: original?.retryPolicy ?? { dispatchMaxAttempts: 3, dispatchMaxAgeMs: 3600000 },
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <form
      {...stylex.props(styles.editor)}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div {...stylex.props(scheduleCard, styles.card)}>
        <Field.Root disabled={disabled}>
          <Field.Label>任务名称</Field.Label>
          <Input
            aria-label="任务名称"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
          />
        </Field.Root>
        <Field.Root disabled={disabled}>
          <Field.Label>提示词</Field.Label>
          <Textarea
            resize="none"
            aria-label="定时任务提示词"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            {...stylex.props(styles.prompt)}
          />
        </Field.Root>
        {targetControl}
        <p {...stylex.props(styles.hint)}>
          运行机器：{machine?.name ?? machineId ?? '未选择'}
          {machine?.status === 'offline' ? ' · 离线，任务等待机器恢复' : ''}
        </p>
        {original && !useCurrentTarget && (
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={disabled || !target}
            onClick={() => setUseCurrentTarget(true)}
          >
            改用当前对话助手
          </Button>
        )}
      </div>
      <div {...stylex.props(scheduleCard, styles.card)}>
        <ChoiceField
          label="结果发送到"
          disabled={disabled}
          value={destination.kind}
          choices={[
            { value: 'new_session', label: '每次新建对话' },
            { value: 'own_session', label: '同一个任务对话' },
            { value: 'existing_session', label: '已有对话' },
          ]}
          onChange={(value) => {
            switch (value) {
              case 'new_session':
                setDestination({ kind: 'new_session' });
                break;
              case 'own_session':
                setDestination({
                  kind: 'own_session',
                  epoch:
                    original?.destination.kind === 'own_session' ? original.destination.epoch : 0,
                });
                break;
              case 'existing_session':
                setDestination({ kind: 'existing_session', sessionId: '' });
            }
          }}
        />
        {destination.kind === 'existing_session' && (
          <ChoiceField
            label="目标对话"
            disabled={disabled}
            value={destination.sessionId}
            choices={snapshot.conversations
              .filter((row) => !row.isArchived)
              .map((row) => ({ value: row.id, label: row.title }))}
            onChange={(sessionId) => setDestination({ kind: 'existing_session', sessionId })}
          />
        )}
        {destination.kind === 'own_session' && original && (
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={disabled}
            onClick={() => setDestination({ ...destination, epoch: destination.epoch + 1 })}
          >
            下次开始新的任务对话
          </Button>
        )}
        <RecurrenceEditor
          value={effectiveRecurrence}
          onChange={setRecurrence}
          timeZone={recurrenceTimeZone(effectiveRecurrence, timeZone)}
          manual={manual}
          onManualChange={setManual}
          disabled={disabled}
        />
        <p {...stylex.props(styles.hint)}>{preview}</p>
        <ChoiceField
          label="错过运行时间"
          disabled={disabled}
          value={misfire}
          choices={[
            { value: 'skip', label: '跳过' },
            { value: 'run_once', label: '恢复后补跑一次' },
          ]}
          onChange={(value) => setMisfire(value === 'run_once' ? 'run_once' : 'skip')}
        />
        <ChoiceField
          label="上次仍在运行时"
          disabled={disabled}
          value={overlap}
          choices={[
            { value: 'skip', label: '跳过本次' },
            { value: 'queue_one', label: '保留一次待运行' },
          ]}
          onChange={(value) => setOverlap(value === 'queue_one' ? 'queue_one' : 'skip')}
        />
      </div>
      {(error || externalError) && (
        <output role="alert" {...stylex.props(styles.hint)}>
          {error || externalError}
        </output>
      )}
      <Button type="submit" disabled={disabled}>
        {busy ? '正在保存…' : '保存定时任务'}
      </Button>
      {!!document?.timeline.length && (
        <section {...stylex.props(styles.section)} aria-label="任务活动">
          <h3 {...stylex.props(styles.title)}>任务活动</h3>
          {document.timeline
            .toReversed()
            .slice(0, 20)
            .map((item) => (
              <p key={item.id} {...stylex.props(styles.hint)}>
                {
                  (
                    {
                      created: '创建',
                      edited: '修改',
                      paused: '暂停',
                      resumed: '恢复',
                      deleted: '删除',
                      manual_run: '请求运行',
                    } as const
                  )[item.kind]
                }{' '}
                · {new Date(item.createdAt).toLocaleString()}
              </p>
            ))}
        </section>
      )}
    </form>
  );
}
