import type { PromptShortcutIndexEntry, PromptShortcutTarget } from '@lody-mobile/sdk';
import {
  getShortcutEmoji,
  resolveShortcutAvailability,
  sameShortcutProject,
} from '@lody-mobile/sdk';

import { formatSkillMentionPrompt, skillMentionToken } from '../chat/mentions/skill-prompt';
import type { ComposerMentionItem, PreparedComposerMention } from '../chat/mentions/types';
import type { LodyClient } from '../connection/client';

export type ShortcutClient = Pick<LodyClient, 'shortcuts' | 'shortcutContext' | 'listSkills'>;
type SkillGroups = Awaited<ReturnType<LodyClient['listSkills']>>;
const scopeReasons: Record<string, string> = {
  project_mismatch: '需要切换到快捷指令所属项目。',
  machine_mismatch: '需要切换到快捷指令指定的机器。',
  provider_mismatch: '需要切换到快捷指令指定的 Agent。',
  permission_denied: '没有读取该快捷指令的权限。',
  missing_scope: '引用缺少项目、机器或 Agent 范围。',
  scope_mismatch: '引用与快捷指令的适用范围不一致。',
  unsupported_reference: '此快捷指令包含当前扩展还不能验证的引用。',
  skill_missing: '引用的技能尚未在当前机器上确认。',
};
function findSkill(target: PromptShortcutTarget, groups: SkillGroups) {
  if (target.kind !== 'skill') return undefined;
  return groups
    .filter((group) => group.scope === target.source && !group.error)
    .flatMap((group) => group.skills)
    .find((skill) => new Set([skill.absolutePath, skill.relativePath]).has(target.path));
}
function reason(entry: PromptShortcutIndexEntry, client: ShortcutClient, groups?: SkillGroups) {
  const result = resolveShortcutAvailability({
    shortcut: entry,
    dependencies: entry.dependencySummary,
    context: client.shortcutContext(),
    canRead: true,
    resolveDependency: (target) =>
      target.kind === 'skill' && (groups === undefined || findSkill(target, groups))
        ? { kind: 'available' }
        : {
            kind: 'unavailable',
            reason: target.kind === 'skill' ? 'skill_missing' : 'unsupported_reference',
          },
  });
  return result.kind === 'available'
    ? undefined
    : (scopeReasons[result.reason] ?? '当前上下文无法使用此快捷指令。');
}

function contextFence(client: ShortcutClient, signal: AbortSignal) {
  const context = structuredClone(client.shortcutContext());
  return () => {
    signal.throwIfAborted();
    const current = client.shortcutContext();
    const projectMatches =
      context.scope.project && current.scope.project
        ? sameShortcutProject(context.scope.project, current.scope.project)
        : context.scope.project === current.scope.project;
    if (
      current.workspaceId !== context.workspaceId ||
      current.userId !== context.userId ||
      current.scope.machineId !== context.scope.machineId ||
      current.scope.providerKey !== context.scope.providerKey ||
      !projectMatches
    )
      throw new Error('对话范围已变化，请重新选择快捷指令。');
  };
}
function assertCurrentEntry(client: ShortcutClient, entry: PromptShortcutIndexEntry) {
  const live = client.shortcuts.getSnapshot().entries.find((row) => row.id === entry.id);
  if (
    !live ||
    live.revision !== entry.revision ||
    live.bodyDocId !== entry.bodyDocId ||
    live.workspaceId !== entry.workspaceId ||
    live.ownerUserId !== entry.ownerUserId ||
    live.visibility !== entry.visibility
  )
    throw new Error('快捷指令已更新或删除，请重新选择。');
}

export async function preparePromptShortcut(
  client: ShortcutClient,
  entry: PromptShortcutIndexEntry,
  signal: AbortSignal,
): Promise<PreparedComposerMention> {
  signal.throwIfAborted();
  const checkContext = contextFence(client, signal);
  const check = () => {
    checkContext();
    assertCurrentEntry(client, entry);
  };
  check();
  const scopeReason = reason(entry, client);
  if (scopeReason) throw new Error(scopeReason);
  const body = await client.shortcuts.read(entry);
  check();
  if (
    body.id !== entry.id ||
    body.revision !== entry.revision ||
    body.workspaceId !== entry.workspaceId ||
    body.ownerUserId !== entry.ownerUserId ||
    body.visibility !== entry.visibility
  )
    throw new Error('快捷指令正文与目录版本不一致，请重新读取。');
  const groups = body.mentions.some((mention) => mention.target.kind === 'skill')
    ? await client.listSkills()
    : [];
  check();
  const unavailable = reason(
    { ...entry, scope: body.scope, dependencySummary: body.mentions.map((row) => row.target) },
    client,
    groups,
  );
  if (unavailable) throw new Error(unavailable);
  return {
    text: body.prompt,
    ranges: body.mentions.map((mention) => {
      const skill = findSkill(mention.target, groups);
      if (!skill || mention.target.kind !== 'skill')
        throw new Error('引用尚未验证，草稿保持不变。');
      return {
        start: mention.start,
        end: mention.end,
        text: mention.label,
        expansion: formatSkillMentionPrompt(skillMentionToken(skill), mention.target.path),
      };
    }),
  };
}

export async function loadPromptShortcutMentions(
  client: ShortcutClient,
  signal: AbortSignal,
): Promise<ComposerMentionItem[]> {
  const checkContext = contextFence(client, signal);
  checkContext();
  await client.shortcuts.connect();
  checkContext();
  const snapshot = client.shortcuts.getSnapshot();
  const context = client.shortcutContext();
  const entries = snapshot.entries.filter(
    (entry) =>
      entry.workspaceId === context.workspaceId &&
      (entry.visibility === 'workspace' || entry.ownerUserId === context.userId),
  );
  const failure = Object.values(snapshot.errors)[0];
  if (!entries.length && failure)
    throw new Error('快捷指令同步失败，请重新读取。', { cause: failure });
  checkContext();
  for (const entry of entries) assertCurrentEntry(client, entry);
  return entries.map((entry) => {
    // Index browsing must not depend on a machine RPC. Selection verifies the body's skills
    // before returning any text; publication errors remain owned by the shortcut manager.
    const disabledReason = reason(entry, client);
    return {
      id: `shortcut:${entry.id}:${entry.revision}`,
      kind: 'shortcut',
      label: entry.slug,
      iconEmoji: getShortcutEmoji(entry),
      exactMatchTerms: [entry.slug, entry.name],
      description: `${entry.name}${entry.description ? ` · ${entry.description}` : ''} · ${entry.visibility === 'private' ? '私有' : '工作区共享'}`,
      keywords: `${entry.slug} ${entry.name} ${entry.description ?? ''}`,
      detail: {
        title: entry.name,
        meta: [`/${entry.slug}`, entry.visibility === 'private' ? '私有' : '工作区共享'],
        ...(entry.description ? { description: entry.description } : {}),
      },
      ...(disabledReason ? { disabledReason } : {}),
      prepare: (selectionSignal) => preparePromptShortcut(client, entry, selectionSignal),
    };
  });
}
