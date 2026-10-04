import * as v from 'valibot';

export const notificationKey = 'lody:notifications';
export const notificationAlarm = 'lody:notifications:poll';
export const notificationPort = 'lody:notifications:foreground';
const observationSchema = v.object({
  status: v.string(),
  activity: v.number(),
  userTurn: v.string(),
});
export type Observation = v.InferOutput<typeof observationSchema>;
const notificationEventSchema = v.object({
  id: v.string(),
  sessionId: v.nullable(v.string()),
  kind: v.picklist(['completed', 'permission', 'failed', 'login']),
  at: v.number(),
});
export type NotificationEvent = v.InferOutput<typeof notificationEventSchema>;
export const notificationStateSchema = v.object({
  scope: v.string(),
  enabled: v.boolean(),
  observed: v.record(v.string(), observationSchema),
  tracked: v.record(v.string(), v.number()),
  terminal: v.optional(v.record(v.string(), v.string()), {}),
  pendingTurns: v.optional(v.record(v.string(), v.string()), {}),
  events: v.array(notificationEventSchema),
  error: v.nullable(v.string()),
  checkedAt: v.number(),
  readCursor: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
  failures: v.number(),
});
export type NotificationState = v.InferOutput<typeof notificationStateSchema>;
export function emptyNotificationState(scope = ''): NotificationState {
  return {
    scope,
    enabled: false,
    observed: {},
    tracked: {},
    terminal: {},
    pendingTurns: {},
    events: [],
    error: null,
    checkedAt: 0,
    readCursor: 0,
    failures: 0,
  };
}
export const foregroundSchema = v.object({
  scope: v.string(),
  sessionId: v.nullable(v.string()),
  visible: v.boolean(),
});
export const navigationSchema = v.object({
  scope: v.string(),
  sessionId: v.string(),
  expiresAt: v.number(),
  tabId: v.number(),
});
export const navigationKey = 'lody:notification-navigation';

export function notificationMessage(kind: NotificationEvent['kind']): string {
  return {
    completed: '助手已完成回复。',
    permission: '有一项操作需要你批准。',
    failed: '会话执行失败，请打开会话查看。',
    login: '请重新登录以继续接收通知。',
  }[kind];
}
