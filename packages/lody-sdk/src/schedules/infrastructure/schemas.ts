import { Cron } from 'croner';
import * as v from 'valibot';

const sensitiveConfigId = /api[_-]?key|auth|bearer|credential|password|passwd|secret|token/i;
const cronFields = /\s+/;
const cronField = /^[\d*,/\-A-Z]+$/i;
const cronExtensions = /[LW?#@+]/i;
const cronNames = /JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|SUN|MON|TUE|WED|THU|FRI|SAT/gi;

export const scheduleIdSchema = v.pipe(v.string(), v.regex(/^[\w-]{1,50}$/));
const id = v.pipe(v.string(), v.minLength(1));
const timestamp = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(8_640_000_000_000_000));
const instant = v.pipe(
  v.string(),
  v.isoTimestamp(),
  v.transform((value) => new Date(value).toISOString()),
);
const triggerSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('manual') }),
  v.strictObject({ kind: v.literal('once'), at: instant }),
  v.strictObject({
    kind: v.literal('interval'),
    everyMs: v.pipe(v.number(), v.integer(), v.minValue(60_000)),
    anchorAt: instant,
  }),
  v.strictObject({
    kind: v.literal('cron'),
    expression: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(256)),
    timeZone: v.pipe(id, v.maxLength(100)),
  }),
]);
const destination = v.variant('kind', [
  v.strictObject({ kind: v.literal('new_session') }),
  v.strictObject({
    kind: v.literal('own_session'),
    epoch: v.pipe(v.number(), v.integer(), v.minValue(0)),
  }),
  v.strictObject({ kind: v.literal('existing_session'), sessionId: id }),
]);
const agent = v.strictObject({
  agentConfigId: id,
  modeId: v.exactOptional(id),
  modelId: v.exactOptional(id),
  configOptionValues: v.exactOptional(
    v.pipe(
      v.record(
        v.pipe(
          id,
          v.maxLength(100),
          v.check((key) => !sensitiveConfigId.test(key)),
        ),
        v.pipe(v.string(), v.maxLength(1024)),
      ),
      v.check((value) => Object.keys(value).length <= 50),
    ),
  ),
});
const project = v.variant('kind', [
  v.strictObject({ kind: v.literal('github'), repoFullName: id, branch: id }),
  v.strictObject({
    kind: v.literal('local'),
    localProjectId: id,
    branch: v.exactOptional(id),
    githubRepoFullName: v.exactOptional(id),
    useWorktree: v.exactOptional(v.boolean()),
  }),
]);
export const definitionSchema = v.strictObject({
  scheduleId: scheduleIdSchema,
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  ownerId: id,
  machineId: id,
  enabled: v.boolean(),
  activationId: scheduleIdSchema,
  activeFrom: timestamp,
  trigger: triggerSchema,
  misfirePolicy: v.strictObject({ kind: v.picklist(['skip', 'run_once']) }),
  overlapPolicy: v.picklist(['skip', 'queue_one']),
  agent,
  project: v.exactOptional(project),
  destination: v.optional(destination, { kind: 'new_session' }),
  retryPolicy: v.strictObject({
    dispatchMaxAttempts: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)),
    dispatchMaxAgeMs: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(86_400_000)),
  }),
  createdAt: timestamp,
  updatedAt: timestamp,
  createdBy: id,
});
export const activitySchema = v.strictObject({
  id: scheduleIdSchema,
  kind: v.picklist(['created', 'edited', 'paused', 'resumed', 'deleted', 'manual_run']),
  requesterSessionId: v.exactOptional(scheduleIdSchema),
  actorId: id,
  createdAt: timestamp,
});
export const documentSchema = v.strictObject({
  definition: definitionSchema,
  prompt: v.pipe(
    v.string(),
    v.check((value) => value.trim().length > 0 && new TextEncoder().encode(value).length <= 32768),
  ),
  timeline: v.array(activitySchema),
});
export const registrySchema = v.object({
  ...v.pick(definitionSchema, [
    'scheduleId',
    'title',
    'ownerId',
    'machineId',
    'enabled',
    'activationId',
    'activeFrom',
    'trigger',
    'destination',
    'createdAt',
    'updatedAt',
  ]).entries,
  elevatedPermissions: v.optional(v.boolean(), false),
  definitionFingerprint: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
  agentConfigId: id,
  projectKind: v.exactOptional(v.picklist(['local', 'github'])),
  projectKey: v.exactOptional(id),
});
export const tombstoneSchema = v.object({ deletedAt: timestamp, actorId: id });
export const runtimeSchema = v.object({
  scheduleId: scheduleIdSchema,
  machineId: id,
  activationId: scheduleIdSchema,
  observedDefinitionFingerprint: v.string(),
  nextScheduledAt: v.exactOptional(timestamp),
  queueState: v.exactOptional(v.picklist(['due', 'waiting_for_agent', 'retrying', 'blocked'])),
  blockedCode: v.exactOptional(v.pipe(v.string(), v.maxLength(100))),
  lastDispatch: v.exactOptional(
    v.object({ scheduledFor: timestamp, dispatchedAt: timestamp, sessionId: v.string() }),
  ),
  updatedAt: timestamp,
});
export const manualSchema = v.object({
  scheduleId: scheduleIdSchema,
  actorId: id,
  manualRunId: scheduleIdSchema,
  activationId: scheduleIdSchema,
  requestedAt: timestamp,
});
export function validateTrigger(value: unknown) {
  const trigger = v.parse(triggerSchema, value);
  if (trigger.kind === 'cron') {
    const fields = trigger.expression.trim().split(cronFields);
    if (
      fields.length !== 5 ||
      fields.some((field) => !cronField.test(field)) ||
      cronExtensions.test(trigger.expression.replace(cronNames, ''))
    )
      throw new Error('Schedule cron must use standard five-field syntax');
    new Intl.DateTimeFormat('en', { timeZone: trigger.timeZone }).format(0);
    const schedule = new Cron(trigger.expression, {
      timezone: trigger.timeZone,
      paused: true,
      domAndDow: false,
    });
    schedule.stop();
  }
  return trigger;
}
