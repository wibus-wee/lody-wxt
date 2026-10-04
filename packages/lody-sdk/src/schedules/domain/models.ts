export type ScheduleTrigger =
  | { kind: 'manual' }
  | { kind: 'once'; at: string }
  | { kind: 'interval'; everyMs: number; anchorAt: string }
  | { kind: 'cron'; expression: string; timeZone: string };
export type ScheduleDestination =
  | { kind: 'new_session' }
  | { kind: 'own_session'; epoch: number }
  | { kind: 'existing_session'; sessionId: string };
export interface ScheduleAgent {
  agentConfigId: string;
  modelId?: string;
  modeId?: string;
  configOptionValues?: Record<string, string>;
}
export type ScheduleProject =
  | { kind: 'github'; repoFullName: string; branch: string }
  | {
      kind: 'local';
      localProjectId: string;
      branch?: string;
      githubRepoFullName?: string;
      useWorktree?: boolean;
    };
export interface ScheduleDraft {
  title: string;
  machineId: string;
  trigger: ScheduleTrigger;
  misfirePolicy: { kind: 'skip' | 'run_once' };
  overlapPolicy: 'skip' | 'queue_one';
  agent: ScheduleAgent;
  project?: ScheduleProject;
  destination?: ScheduleDestination;
  retryPolicy: { dispatchMaxAttempts: number; dispatchMaxAgeMs: number };
  prompt: string;
}
export interface ScheduleDefinition extends Omit<ScheduleDraft, 'prompt' | 'destination'> {
  scheduleId: string;
  ownerId: string;
  enabled: boolean;
  activationId: string;
  activeFrom: number;
  destination: ScheduleDestination;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}
export interface ScheduleActivity {
  id: string;
  kind: 'created' | 'edited' | 'paused' | 'resumed' | 'deleted' | 'manual_run';
  actorId: string;
  requesterSessionId?: string;
  createdAt: number;
}
export interface ScheduleDocument {
  definition: ScheduleDefinition;
  prompt: string;
  timeline: ScheduleActivity[];
}
export interface ScheduleRegistryRow extends Pick<
  ScheduleDefinition,
  | 'scheduleId'
  | 'title'
  | 'ownerId'
  | 'machineId'
  | 'enabled'
  | 'activationId'
  | 'activeFrom'
  | 'trigger'
  | 'destination'
  | 'createdAt'
  | 'updatedAt'
> {
  elevatedPermissions: boolean;
  definitionFingerprint: string;
  agentConfigId: string;
  projectKind?: 'local' | 'github';
  projectKey?: string;
}
export interface ScheduleRuntimeRow {
  scheduleId: string;
  machineId: string;
  activationId: string;
  observedDefinitionFingerprint: string;
  nextScheduledAt?: number;
  queueState?: 'due' | 'waiting_for_agent' | 'retrying' | 'blocked';
  blockedCode?: string;
  lastDispatch?: { scheduledFor: number; dispatchedAt: number; sessionId: string };
  updatedAt: number;
}
export interface ScheduleSave {
  scheduleId: string;
  draft: ScheduleDraft;
  actorId: string;
  now: number;
  activationId: string;
  activityId: string;
  create?: boolean;
}
export interface ScheduleEnable {
  scheduleId: string;
  enabled: boolean;
  actorId: string;
  now: number;
  activationId: string;
  requestId: string;
  requesterSessionId?: string;
}
export interface ScheduleRunRequest {
  scheduleId: string;
  actorId: string;
  manualRunId: string;
  now: number;
}
