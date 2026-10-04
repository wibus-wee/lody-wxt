import type {
  PromptShortcut,
  PromptShortcutIndexEntry,
  PromptShortcutProject,
  PromptShortcutScope,
  PromptShortcutTarget,
  ShortcutLocalRecord,
} from './models.js';

export function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function sameProject(
  left: PromptShortcutProject | undefined,
  right: PromptShortcutProject | undefined,
): boolean {
  if (!left || !right) return left === right;
  switch (left.kind) {
    case 'github':
      return right.kind === 'github' && left.repository === right.repository;
    case 'local':
      return right.kind === 'local' && left.id === right.id && left.machineId === right.machineId;
  }
}
function sameScope(left: PromptShortcutScope, right: PromptShortcutScope): boolean {
  return (
    sameProject(left.project, right.project) &&
    left.machineId === right.machineId &&
    left.providerKey === right.providerKey
  );
}
function sameTarget(left: PromptShortcutTarget, right: PromptShortcutTarget): boolean {
  switch (left.kind) {
    case 'file':
      return (
        right.kind === 'file' &&
        sameProject(left.project, right.project) &&
        left.path === right.path &&
        left.directory === right.directory
      );
    case 'skill':
      return (
        right.kind === 'skill' &&
        left.source === right.source &&
        sameProject(left.project, right.project) &&
        left.machineId === right.machineId &&
        left.path === right.path &&
        sameStrings(left.compatibleProviders, right.compatibleProviders)
      );
    case 'agent_role':
      return right.kind === 'agent_role' && left.agentRoleId === right.agentRoleId;
    case 'issue':
    case 'pull_request':
      return (
        right.kind === left.kind &&
        left.repository === right.repository &&
        left.number === right.number
      );
  }
}
function sameSummary(
  left: Omit<PromptShortcut, 'prompt' | 'mentions'>,
  right: Omit<PromptShortcut, 'prompt' | 'mentions'>,
): boolean {
  return (
    left.v === right.v &&
    left.id === right.id &&
    left.workspaceId === right.workspaceId &&
    left.ownerUserId === right.ownerUserId &&
    left.visibility === right.visibility &&
    left.name === right.name &&
    left.emoji === right.emoji &&
    left.slug === right.slug &&
    left.description === right.description &&
    sameScope(left.scope, right.scope) &&
    left.revision === right.revision &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt
  );
}
export function sameShortcutIndex(
  left: PromptShortcutIndexEntry | null | undefined,
  right: PromptShortcutIndexEntry | null | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    sameSummary(left, right) &&
    left.bodyDocId === right.bodyDocId &&
    left.dependencySummary.length === right.dependencySummary.length &&
    left.dependencySummary.every((target, index) =>
      sameTarget(target, right.dependencySummary[index]!),
    )
  );
}
export function samePromptShortcut(left: PromptShortcut, right: PromptShortcut): boolean {
  return (
    sameSummary(left, right) &&
    left.prompt === right.prompt &&
    left.mentions.length === right.mentions.length &&
    left.mentions.every((mention, index) => {
      const other = right.mentions[index]!;
      return (
        mention.start === other.start &&
        mention.end === other.end &&
        mention.label === other.label &&
        sameTarget(mention.target, other.target)
      );
    })
  );
}
export function sameShortcutRecord(
  left: ShortcutLocalRecord | null,
  right: ShortcutLocalRecord,
): boolean {
  return (
    !!left &&
    sameShortcutIndex(left.entry, right.entry) &&
    sameShortcutIndex(left.published, right.published) &&
    left.operation === right.operation &&
    left.deleted === right.deleted
  );
}
