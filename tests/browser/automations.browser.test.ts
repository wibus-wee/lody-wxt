import { expect, it, vi } from 'vitest';

import {
  loadScheduleOperation,
  resumeScheduleOperation,
  stageScheduleOperation,
} from '../../src/features/automations/journal';
import {
  applyScheduleRecurrence,
  triggerToRecurrence,
  zonedLocalInputToInstant,
} from '../../src/features/automations/recurrence';
import {
  automationScope,
  deleteWorkflow,
  importWorkflows,
  loadWorkflows,
  saveWorkflow,
} from '../../src/features/automations/storage';
import {
  fillWorkflowParameters,
  parseWorkflowImport,
  serializeWorkflows,
  workflowParameters,
} from '../../src/features/automations/workflow-transfer';
import type { ChatSchedules } from '../../src/features/connection/client';

it('serializes concurrent local workflow writes and isolates deployment/workspace scopes', async () => {
  const scope = automationScope(`account-${crypto.randomUUID()}`, 'workspace-a');
  const other = automationScope(scope, 'workspace-b');
  const first = {
    id: 'first',
    title: 'First',
    prompt: 'Compare {{topic}}',
    includeCurrentPage: false,
    updatedAt: 1,
  };
  const second = { ...first, id: 'second', title: 'Second' };
  await Promise.all([saveWorkflow(scope, first), saveWorkflow(scope, second)]);
  expect(await loadWorkflows(scope)).toHaveLength(2);
  expect(await loadWorkflows(other)).toEqual([]);
  const exported = serializeWorkflows(await loadWorkflows(scope));
  const imported = parseWorkflowImport(exported, 2);
  expect(imported[0]!.id).not.toBe(first.id);
  await importWorkflows(other, imported);
  await deleteWorkflow(scope, first.id);
  expect(await loadWorkflows(scope)).toEqual([second]);
  expect(await loadWorkflows(other)).toHaveLength(2);
});

it('substitutes inert named parameters and rejects malformed workflow imports', () => {
  expect(workflowParameters('{{主题}} then {{主题}} and {{format}}')).toEqual(['主题', 'format']);
  expect(
    fillWorkflowParameters('{{topic}} / {{constructor}}', {
      topic: '<script>no execution</script>',
      constructor: 'literal',
    }),
  ).toBe('<script>no execution</script> / literal');
  expect(() => fillWorkflowParameters('{{constructor}}', {})).toThrow('constructor');
  expect(() =>
    parseWorkflowImport(
      JSON.stringify({
        version: 1,
        workflows: [
          { title: 'bad', prompt: 'text', includeCurrentPage: false, runAutomatically: true },
        ],
      }),
      1,
    ),
  ).toThrow();
  expect(() => parseWorkflowImport(JSON.stringify({ version: 2, workflows: [] }), 1)).toThrow();
});

it('keeps a manual run request durable after uncertain publication and reuses its identity', async () => {
  const scope = automationScope(crypto.randomUUID(), 'schedule-recovery');
  const input = { scheduleId: 'schedule-id', manualRunId: 'stable-run-id', now: 1791100000000 };
  const requestRun = vi
    .fn()
    .mockRejectedValueOnce(new Error('Lost confirmation'))
    .mockResolvedValue(undefined);
  const schedules: ChatSchedules = {
    list: async () => [],
    read: async () => null,
    runtimeRows: async () => [],
    requestRun,
    save: async () => {
      throw new Error('Not called');
    },
    setEnabled: async () => {},
    delete: async () => {},
  };
  await stageScheduleOperation(scope, { kind: 'run', input });
  await expect(resumeScheduleOperation(scope, schedules)).rejects.toThrow('Lost confirmation');
  expect(await loadScheduleOperation(scope)).toEqual({ kind: 'run', input });
  await expect(
    stageScheduleOperation(scope, { kind: 'run', input: { ...input, manualRunId: 'other' } }),
  ).rejects.toThrow('尚待确认');
  await resumeScheduleOperation(scope, schedules);
  expect(requestRun.mock.calls).toEqual([[input], [input]]);
  expect(await loadScheduleOperation(scope)).toBeNull();
});

it('preserves untouched recurrence fingerprints and upstream daylight-saving instant behavior', () => {
  const original = {
    kind: 'cron' as const,
    expression: '30 9 * * MON-FRI',
    timeZone: 'America/New_York',
  };
  expect(applyScheduleRecurrence(triggerToRecurrence(original), 1791100000000, original)).toBe(
    original,
  );
  expect(
    new Date(zonedLocalInputToInstant('2026-11-01T01:30', 'America/New_York')!).toISOString(),
  ).toBe('2026-11-01T05:30:00.000Z');
  expect(
    new Date(zonedLocalInputToInstant('2026-03-08T02:30', 'America/New_York')!).toISOString(),
  ).toBe('2026-03-08T07:30:00.000Z');
});
