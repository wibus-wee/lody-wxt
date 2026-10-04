import type { ScheduleDraft } from '@lody-mobile/sdk';
import { validateScheduleTrigger } from '@lody-mobile/sdk';
import * as v from 'valibot';

import { readLocal, writeLocal } from '../../shared/storage';
import type { ChatSchedules } from '../connection/client';

const draftSchema = v.object({
  title: v.string(),
  machineId: v.string(),
  prompt: v.string(),
  trigger: v.pipe(v.unknown(), v.transform(validateScheduleTrigger)),
  agent: v.object({
    agentConfigId: v.string(),
    modelId: v.exactOptional(v.string()),
    modeId: v.exactOptional(v.string()),
    configOptionValues: v.exactOptional(v.record(v.string(), v.string())),
  }),
  destination: v.exactOptional(
    v.variant('kind', [
      v.object({ kind: v.literal('new_session') }),
      v.object({ kind: v.literal('own_session'), epoch: v.number() }),
      v.object({ kind: v.literal('existing_session'), sessionId: v.string() }),
    ]),
  ),
  project: v.exactOptional(
    v.variant('kind', [
      v.object({ kind: v.literal('github'), repoFullName: v.string(), branch: v.string() }),
      v.object({
        kind: v.literal('local'),
        localProjectId: v.string(),
        branch: v.exactOptional(v.string()),
        githubRepoFullName: v.exactOptional(v.string()),
        useWorktree: v.exactOptional(v.boolean()),
      }),
    ]),
  ),
  misfirePolicy: v.object({ kind: v.picklist(['skip', 'run_once']) }),
  overlapPolicy: v.picklist(['skip', 'queue_one']),
  retryPolicy: v.object({ dispatchMaxAttempts: v.number(), dispatchMaxAgeMs: v.number() }),
}) satisfies v.GenericSchema<unknown, ScheduleDraft>;
const operationSchema = v.variant('kind', [
  v.object({
    kind: v.literal('save'),
    input: v.object({
      scheduleId: v.string(),
      draft: draftSchema,
      now: v.number(),
      activationId: v.string(),
      activityId: v.string(),
      create: v.exactOptional(v.boolean()),
    }),
  }),
  v.object({
    kind: v.literal('enable'),
    input: v.object({
      scheduleId: v.string(),
      enabled: v.boolean(),
      now: v.number(),
      activationId: v.string(),
      requestId: v.string(),
    }),
  }),
  v.object({
    kind: v.literal('run'),
    input: v.object({ scheduleId: v.string(), manualRunId: v.string(), now: v.number() }),
  }),
  v.object({ kind: v.literal('delete'), input: v.object({ scheduleId: v.string() }) }),
]);
export type ScheduleOperation = v.InferOutput<typeof operationSchema>;
const journalSchema = v.object({ operation: v.nullable(operationSchema) });
const journalKey = (scope: string) => `automation:schedule-operation:${scope}`;
export async function loadScheduleOperation(scope: string): Promise<ScheduleOperation | null> {
  const saved = await readLocal(journalKey(scope));
  return saved == null ? null : v.parse(journalSchema, saved).operation;
}
export async function stageScheduleOperation(
  scope: string,
  operation: ScheduleOperation,
): Promise<void> {
  await navigator.locks.request(journalKey(scope), async () => {
    if (await loadScheduleOperation(scope))
      throw new Error('上一次定时任务操作尚待确认，请先恢复。');
    await writeLocal(journalKey(scope), { operation: v.parse(operationSchema, operation) });
  });
}
export async function resumeScheduleOperation(
  scope: string,
  schedules: ChatSchedules,
): Promise<void> {
  await navigator.locks.request(journalKey(scope), async () => {
    const operation = await loadScheduleOperation(scope);
    if (!operation) return;
    switch (operation.kind) {
      case 'save':
        await schedules.save(operation.input);
        break;
      case 'enable':
        await schedules.setEnabled(operation.input);
        break;
      case 'run':
        await schedules.requestRun(operation.input);
        break;
      case 'delete':
        await schedules.delete(operation.input.scheduleId);
        break;
    }
    await writeLocal(journalKey(scope), { operation: null });
  });
}
