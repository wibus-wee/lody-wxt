import * as v from 'valibot';

const required = v.pipe(v.string(), v.trim(), v.minLength(1));
export const draftSchema = v.strictObject({
  convexSiteUrl: v.pipe(required, v.url(), v.regex(/^https:\/\/[^/?#@]+\/?$/)),
  machineId: required,
  agentConfigId: required,
  localProjectId: v.pipe(v.string(), v.trim()),
  branch: v.pipe(v.string(), v.trim()),
  modelId: v.pipe(v.string(), v.trim()),
  agentType: required,
  cliType: v.picklist(['builtin', 'registry', 'custom']),
  title: required,
  prompt: required,
});
export type ConversationDraft = v.InferOutput<typeof draftSchema>;
export const savedDraftSchema = v.strictObject({
  convexSiteUrl: v.string(),
  machineId: v.string(),
  agentConfigId: v.string(),
  localProjectId: v.string(),
  branch: v.string(),
  modelId: v.string(),
  agentType: v.string(),
  cliType: v.picklist(['builtin', 'registry', 'custom']),
  title: v.string(),
  prompt: v.string(),
});
export const receiptSchema = v.strictObject({
  requestId: v.pipe(v.string(), v.uuid()),
  sessionId: required,
  turnId: required,
  state: v.picklist(['pending', 'submitted', 'unconfirmed']),
});
export const journalSchema = v.strictObject({
  key: required,
  scope: required,
  requestId: v.pipe(v.string(), v.uuid()),
  createdAt: v.number(),
  state: v.picklist(['unconfirmed', 'accepted']),
  receipt: v.nullable(receiptSchema),
});
export type SendJournal = v.InferOutput<typeof journalSchema>;
