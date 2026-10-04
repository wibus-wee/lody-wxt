export type PromptShortcutProject =
  | { kind: 'github'; repository: string }
  | { kind: 'local'; id: string; machineId: string };
export interface PromptShortcutScope {
  project?: PromptShortcutProject;
  machineId?: string;
  providerKey?: string;
}
export type PromptShortcutTarget =
  | { kind: 'file'; project: PromptShortcutProject; path: string; directory?: boolean }
  | {
      kind: 'skill';
      source: 'project' | 'global' | 'system';
      project?: PromptShortcutProject;
      machineId?: string;
      path: string;
      compatibleProviders: string[];
    }
  | { kind: 'agent_role'; agentRoleId: string }
  | { kind: 'issue' | 'pull_request'; repository: string; number: number };
export interface PromptShortcutMention {
  start: number;
  end: number;
  label: string;
  target: PromptShortcutTarget;
}
export interface PromptShortcut {
  v: 1;
  id: string;
  workspaceId: string;
  ownerUserId: string;
  visibility: 'private' | 'workspace';
  name: string;
  emoji?: string;
  slug: string;
  description?: string;
  prompt: string;
  mentions: PromptShortcutMention[];
  scope: PromptShortcutScope;
  revision: string;
  createdAt: number;
  updatedAt: number;
}
export interface PromptShortcutIndexEntry extends Omit<PromptShortcut, 'prompt' | 'mentions'> {
  bodyDocId: string;
  dependencySummary: PromptShortcutTarget[];
}
export type PromptShortcutCatalogRecord =
  | { kind: 'active'; entry: PromptShortcutIndexEntry }
  | { kind: 'deleted'; id: string; revision: string };
export interface ShortcutLocalRecord {
  entry: PromptShortcutIndexEntry;
  published: PromptShortcutIndexEntry | null;
  operation: 'save' | 'delete' | null;
  deleted: boolean;
}
export interface ShortcutDirectoryEntry {
  shortcutId: string;
  bodyDocId: string;
  ownerUserId: string;
  visibility: 'private' | 'workspace';
  revision: string | null;
  deleted?: boolean;
}
export interface ShortcutAccessDomain {
  workspaceId: string;
  ownerUserId: string;
  visibility: 'private' | 'workspace';
}
export type ShortcutResource =
  | { kind: 'index'; domain: ShortcutAccessDomain }
  | { kind: 'body'; bodyDocId: string };
export interface ShortcutStreamGrant {
  token: string;
  expiresIn: number;
  gatewayBaseUrl: string;
  streamId: string;
}
export interface ShortcutRuntimeSnapshot {
  entries: readonly PromptShortcutIndexEntry[];
  pendingIds: readonly string[];
  errors: Readonly<Record<string, unknown>>;
  loading: boolean;
}

export const PROMPT_SHORTCUT_LIMITS = {
  /** Author-facing field lengths, shared with the editor's own `maxLength`. */
  name: 60,
  emoji: 8,
  slug: 40,
  description: 240,
  promptBytes: 256 * 1024,
  documentBytes: 512 * 1024,
  indexBytes: 8 * 1024,
  mentions: 50,
} as const;

/**
 * A real default rather than a blank slot: every Shortcut then reads the same
 * way in the list, and the picker is a change rather than a decision the author
 * has to make before the Shortcut looks finished.
 */
export const DEFAULT_PROMPT_SHORTCUT_EMOJI = '📝';

/**
 * Keep an emoji to one short, whitespace-free glyph.
 *
 * Capped and stripped rather than validated against an emoji table: the field
 * is decoration, so the only real requirements are that it cannot smuggle a
 * second line of text into a row and cannot carry invisible characters.
 */
const controlCharacters = /\p{Cc}/gu;
const whitespace = /\s+/gu;
export const normalizeShortcutEmoji = (value: string): string | undefined => {
  const stripped = value.replace(controlCharacters, '').replace(whitespace, '');
  const capped = Array.from(stripped).slice(0, PROMPT_SHORTCUT_LIMITS.emoji).join('');
  return capped || undefined;
};

export const shortcutByteLength = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

export const getShortcutEmoji = (shortcut: Pick<PromptShortcut, 'emoji'>): string =>
  shortcut.emoji || DEFAULT_PROMPT_SHORTCUT_EMOJI;
export class PromptShortcutError extends Error {
  constructor(
    readonly code:
      | 'invalid_template'
      | 'missing_scope'
      | 'scope_mismatch'
      | 'invalid_ranges'
      | 'size_limit'
      | 'conflict'
      | 'not_found'
      | 'forbidden'
      | 'revision_pending'
      | 'index_pending',
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(message);
    this.name = 'PromptShortcutError';
  }
}

export function sameShortcutProject(a: PromptShortcutProject, b: PromptShortcutProject): boolean {
  if (a.kind === 'github' && b.kind === 'github') {
    return a.repository.toLowerCase() === b.repository.toLowerCase();
  }
  return a.kind === 'local' && b.kind === 'local' && a.id === b.id && a.machineId === b.machineId;
}

export type ShortcutScopeIssue = {
  code: 'missing_scope' | 'scope_mismatch';
  axis: keyof PromptShortcutScope;
};

export function getShortcutMentionScopeIssues(
  scope: PromptShortcutScope,
  target: PromptShortcutTarget,
): ShortcutScopeIssue[] {
  const issues: ShortcutScopeIssue[] = [];
  let project: PromptShortcutProject | undefined;
  let machineId: string | undefined;
  switch (target.kind) {
    case 'file':
    case 'skill':
      project = target.project;
      break;
    case 'issue':
    case 'pull_request':
      project = { kind: 'github', repository: target.repository };
      break;
    case 'agent_role':
      break;
  }
  if (project?.kind === 'local') machineId = project.machineId;
  if (target.kind === 'skill') machineId = target.machineId ?? machineId;
  if (project) {
    if (!scope.project) issues.push({ code: 'missing_scope', axis: 'project' });
    else if (!sameShortcutProject(scope.project, project))
      issues.push({ code: 'scope_mismatch', axis: 'project' });
  }
  if (machineId !== undefined) {
    if (scope.machineId === undefined) issues.push({ code: 'missing_scope', axis: 'machineId' });
    else if (scope.machineId !== machineId)
      issues.push({ code: 'scope_mismatch', axis: 'machineId' });
  }
  if (target.kind === 'skill') {
    if (scope.providerKey === undefined)
      issues.push({ code: 'missing_scope', axis: 'providerKey' });
    else if (!target.compatibleProviders.includes(scope.providerKey)) {
      issues.push({ code: 'scope_mismatch', axis: 'providerKey' });
    }
  }
  // A Role's provider describes its target session, not this composer.
  return issues;
}

/** Used before source activation: missing scope leaves a discoverable disabled category. */
export function getShortcutMentionGate(
  type:
    | 'file'
    | 'project_skill'
    | 'global_skill'
    | 'system_skill'
    | 'agent_role'
    | 'issue'
    | 'pull_request',
  scope: PromptShortcutScope,
): { enabled: boolean; missing: (keyof PromptShortcutScope)[] } {
  const missing: (keyof PromptShortcutScope)[] = [];
  if (type === 'agent_role') return { enabled: true, missing };
  const homeSkill = new Set(['global_skill', 'system_skill']).has(type);
  if (!homeSkill && !scope.project) missing.push('project');
  if ((homeSkill || scope.project?.kind === 'local') && scope.machineId === undefined)
    missing.push('machineId');
  if (type.endsWith('_skill') && scope.providerKey === undefined) missing.push('providerKey');
  const githubOnly = new Set(['issue', 'pull_request']).has(type);
  const localMachineMatches =
    scope.project?.kind !== 'local' ||
    scope.machineId === undefined ||
    scope.project.machineId === scope.machineId;
  return {
    enabled:
      missing.length === 0 &&
      localMachineMatches &&
      (!githubOnly || scope.project?.kind === 'github'),
    missing,
  };
}

export type ShortcutAvailability =
  | { kind: 'available' }
  | { kind: 'unknown'; reason: string }
  | { kind: 'unavailable'; reason: string };

export function resolveShortcutAvailability(input: {
  shortcut: Pick<PromptShortcut, 'workspaceId' | 'ownerUserId' | 'visibility' | 'scope'>;
  dependencies: readonly PromptShortcutTarget[];
  context: { workspaceId: string; userId: string; scope: PromptShortcutScope };
  canRead: boolean;
  resolveDependency: (target: PromptShortcutTarget) => ShortcutAvailability;
}): ShortcutAvailability {
  const { shortcut, context, dependencies } = input;
  if (
    !input.canRead ||
    shortcut.workspaceId !== context.workspaceId ||
    (shortcut.visibility === 'private' && shortcut.ownerUserId !== context.userId)
  ) {
    return { kind: 'unavailable', reason: 'permission_denied' };
  }
  for (const target of dependencies) {
    const issue = getShortcutMentionScopeIssues(shortcut.scope, target).at(0);
    if (issue) return { kind: 'unavailable', reason: issue.code };
  }
  const scope = shortcut.scope;
  if (
    scope.project &&
    (!context.scope.project || !sameShortcutProject(scope.project, context.scope.project))
  ) {
    return { kind: 'unavailable', reason: 'project_mismatch' };
  }
  if (scope.machineId !== undefined && context.scope.machineId !== scope.machineId)
    return { kind: 'unavailable', reason: 'machine_mismatch' };
  if (scope.providerKey !== undefined && context.scope.providerKey !== scope.providerKey)
    return { kind: 'unavailable', reason: 'provider_mismatch' };
  let pending: ShortcutAvailability | undefined;
  for (const target of dependencies) {
    const result = input.resolveDependency(target);
    if (result.kind === 'unavailable') return result;
    if (result.kind === 'unknown') pending = result;
  }
  return pending ?? { kind: 'available' };
}
