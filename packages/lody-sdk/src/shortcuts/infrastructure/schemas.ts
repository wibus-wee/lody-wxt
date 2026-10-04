import * as v from 'valibot';

import {
  normalizeShortcutEmoji,
  PROMPT_SHORTCUT_LIMITS,
  shortcutByteLength,
} from '../domain/models.js';

const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(200));
const text = (max: number) => v.pipe(v.string(), v.minLength(1), v.maxLength(max));
const nonnegative = v.pipe(v.number(), v.integer(), v.minValue(0));
const positive = v.pipe(v.number(), v.integer(), v.minValue(1));
const projectSchema = v.variant('kind', [
  v.strictObject({
    kind: v.literal('github'),
    repository: v.pipe(v.string(), v.regex(/^[^/\s]+\/[^/\s]+$/)),
  }),
  v.strictObject({ kind: v.literal('local'), id: identifier, machineId: identifier }),
]);
const scopeSchema = v.strictObject({
  project: v.exactOptional(projectSchema),
  machineId: v.exactOptional(identifier),
  providerKey: v.exactOptional(identifier),
});
const repository = v.pipe(v.string(), v.regex(/^[^/\s]+\/[^/\s]+$/));
const targetSchema = v.variant('kind', [
  v.strictObject({
    kind: v.literal('file'),
    project: projectSchema,
    path: text(4096),
    directory: v.exactOptional(v.boolean()),
  }),
  v.strictObject({
    kind: v.literal('skill'),
    source: v.picklist(['project', 'global', 'system']),
    project: v.exactOptional(projectSchema),
    machineId: v.exactOptional(identifier),
    path: text(4096),
    compatibleProviders: v.pipe(v.array(identifier), v.minLength(1), v.maxLength(32)),
  }),
  v.strictObject({ kind: v.literal('agent_role'), agentRoleId: identifier }),
  v.strictObject({ kind: v.literal('issue'), repository, number: positive }),
  v.strictObject({ kind: v.literal('pull_request'), repository, number: positive }),
]);
const summary = {
  v: v.literal(1),
  id: identifier,
  workspaceId: identifier,
  ownerUserId: identifier,
  visibility: v.picklist(['private', 'workspace']),
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(PROMPT_SHORTCUT_LIMITS.name)),
  emoji: v.exactOptional(
    v.pipe(
      v.string(),
      v.check((value) => normalizeShortcutEmoji(value) === value),
    ),
  ),
  slug: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]{0,39}$/)),
  description: v.exactOptional(v.pipe(v.string(), v.maxLength(PROMPT_SHORTCUT_LIMITS.description))),
  scope: scopeSchema,
  revision: identifier,
  createdAt: nonnegative,
  updatedAt: nonnegative,
};
export const PromptShortcutSchema = v.strictObject({
  ...summary,
  prompt: v.pipe(
    v.string(),
    v.check((value) => shortcutByteLength(value) <= PROMPT_SHORTCUT_LIMITS.promptBytes),
  ),
  mentions: v.pipe(
    v.array(
      v.strictObject({
        start: nonnegative,
        end: positive,
        label: text(4096),
        target: targetSchema,
      }),
    ),
    v.maxLength(PROMPT_SHORTCUT_LIMITS.mentions),
  ),
});
export const PromptShortcutIndexSchema = v.strictObject({
  ...summary,
  bodyDocId: identifier,
  dependencySummary: v.pipe(v.array(targetSchema), v.maxLength(PROMPT_SHORTCUT_LIMITS.mentions)),
});
export const catalogRecordSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('active'), entry: PromptShortcutIndexSchema }),
  v.strictObject({ kind: v.literal('deleted'), id: text(200), revision: text(200) }),
]);
export const revisionSchema = v.strictObject({
  parents: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.maxLength(100)),
});
export const localRecordSchema = v.strictObject({
  entry: PromptShortcutIndexSchema,
  published: v.nullable(PromptShortcutIndexSchema),
  operation: v.nullable(v.picklist(['save', 'delete'])),
  deleted: v.boolean(),
});
export const directoryEntrySchema = v.object({
  shortcutId: identifier,
  bodyDocId: identifier,
  ownerUserId: identifier,
  visibility: v.picklist(['private', 'workspace']),
  revision: v.nullable(identifier),
  deleted: v.exactOptional(v.boolean()),
});
export const discoverySchema = v.object({
  directory: v.array(directoryEntrySchema),
  entries: v.array(PromptShortcutIndexSchema),
});
export const intentSchema = v.object({
  record: localRecordSchema,
  baseRevision: v.nullable(v.string()),
});
export const shortcutResourceSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('body'), bodyDocId: identifier }),
  v.strictObject({
    kind: v.literal('index'),
    domain: v.strictObject({
      workspaceId: identifier,
      ownerUserId: identifier,
      visibility: v.picklist(['private', 'workspace']),
    }),
  }),
]);
const grantSchema = v.object({
  token: v.pipe(v.string(), v.minLength(1)),
  expiresIn: v.pipe(v.number(), v.finite(), v.minValue(Number.MIN_VALUE)),
  gatewayBaseUrl: v.pipe(v.string(), v.url()),
  streamId: v.pipe(
    v.string(),
    v.minLength(1),
    v.check((value) => shortcutByteLength(value) <= 512),
  ),
});
export function validateShortcutGrant(value: unknown) {
  const result = v.parse(grantSchema, value);
  shortcutOrigin(result.gatewayBaseUrl);
  return result;
}
export function shortcutOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid Shortcut origin');
  return url.origin;
}
export function createShortcutStreamUrl(input: { baseUrl: string; streamId: string }): string {
  if (
    !input.streamId ||
    shortcutByteLength(input.streamId) > 512 ||
    input.streamId.includes('/') ||
    input.streamId.includes('\0') ||
    input.streamId.includes('..')
  )
    throw new Error('Invalid Shortcut stream ID');
  return `${shortcutOrigin(input.baseUrl)}/ds/lody/${encodeURIComponent(input.streamId)}`;
}
