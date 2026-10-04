import { isExtension } from '../../../shared/storage';
import { loadPromptShortcutMentions } from '../../automations/prompt-shortcut-source';
import type { ExecutionTarget, LodyClient } from '../../connection/client';
import { capturePage, listContextTabs } from '../../page-context/capture';
import { formatSkillMentionPrompt, skillMentionToken } from './skill-prompt';
import type { ComposerMentionSource } from './types';

const leadingSlash = /^\//u;
const spaces = /\s+/gu;
const slugSeparators = /[@/:]/gu;
const backslashes = /\\/gu;
const brackets = /[[\]]/gu;
const skillScopeOrder = { project: 0, global: 1, system: 2 };
const skillScopeLabels = { project: '项目', global: '全局', system: '系统' };

export function createComposerMentionSource({
  client,
  sessionId,
  target,
}: {
  client: LodyClient;
  sessionId: string;
  target: ExecutionTarget | null;
}): ComposerMentionSource {
  const scopeKey = JSON.stringify([client.accountKey, sessionId, target]);
  const current = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (JSON.stringify([client.accountKey, sessionId, client.getSnapshot().target]) !== scopeKey)
      throw new Error('对话助手已改变，请重新选择。');
  };
  return {
    scopeKey,
    async retry(kind, signal) {
      current(signal);
      if (kind === 'shortcut') await client.shortcuts.retry();
      current(signal);
    },
    subscribe(listener) {
      let shortcutState = client.shortcuts.getSnapshot();
      let entries = new Map(
        shortcutState.entries.map((entry) => [entry.id, `${entry.revision}:${entry.bodyDocId}`]),
      );
      let commands = client.getSnapshot().availableCommands ?? [];
      const stopShortcuts = client.shortcuts.subscribe(() => {
        const nextState = client.shortcuts.getSnapshot();
        const next = nextState.entries;
        const directoryChanged =
          shortcutState.loading !== nextState.loading ||
          shortcutState.errors.directory !== nextState.errors.directory ||
          shortcutState.errors.initialization !== nextState.errors.initialization ||
          (next.length === 0 &&
            (Object.keys(shortcutState.errors).length !== Object.keys(nextState.errors).length ||
              Object.entries(nextState.errors).some(
                ([key, error]) => shortcutState.errors[key] !== error,
              )));
        shortcutState = nextState;
        if (
          directoryChanged ||
          entries.size !== next.length ||
          next.some((entry) => entries.get(entry.id) !== `${entry.revision}:${entry.bodyDocId}`)
        ) {
          entries = new Map(
            next.map((entry) => [entry.id, `${entry.revision}:${entry.bodyDocId}`]),
          );
          listener();
        }
      });
      const stopClient = client.subscribe(() => {
        const next = client.getSnapshot().availableCommands ?? [];
        if (
          commands.length !== next.length ||
          next.some(
            (command, index) =>
              command.name !== commands[index]?.name ||
              command.description !== commands[index]?.description,
          )
        ) {
          commands = next;
          listener();
        }
      });
      return () => {
        stopShortcuts();
        stopClient();
      };
    },
    categories: [
      ...(isExtension() ? ['tab' as const] : []),
      'skill',
      'session',
      'shortcut',
      'command',
    ],
    async load(kind, signal) {
      current(signal);
      switch (kind) {
        case 'shortcut':
          return loadPromptShortcutMentions(client, signal);
        case 'command':
          return (client.getSnapshot().availableCommands ?? []).map((command) => ({
            id: command.name,
            kind,
            label: `/${command.name.replace(leadingSlash, '')}`,
            ...(command.description ? { description: command.description } : {}),
            detail: {
              title: `/${command.name.replace(leadingSlash, '')}`,
              ...(command.description ? { description: command.description } : {}),
            },
            prepare: async (selectionSignal) => {
              current(selectionSignal);
              if (
                !client.getSnapshot().availableCommands?.some((item) => item.name === command.name)
              )
                throw new Error('此命令已不可用，请重新读取。');
              return { text: `/${command.name.replace(leadingSlash, '')}` };
            },
          }));
        case 'session': {
          await client.list();
          current(signal);
          return client
            .getSnapshot()
            .conversations.filter((session) => session.id !== sessionId && !session.isArchived)
            .map((session) => ({
              id: session.id,
              kind,
              label: session.title,
              description: '引用 Lody 会话',
              detail: { title: session.title, meta: ['Lody 会话'] },
              prepare: async (selectionSignal) => {
                current(selectionSignal);
                const readable = await client.readConversation(session.id);
                current(selectionSignal);
                if (readable.isArchived) throw new Error('此会话已归档，请选择其他会话。');
                const title = readable.title.trim() || readable.id;
                const slug = title.replace(spaces, '-').replace(slugSeparators, '-');
                const label = `@${title}`.replace(backslashes, '\\\\').replace(brackets, '\\$&');
                return { text: `@${slug}`, expansion: `[${label}](session://${readable.id})` };
              },
            }));
        }
        case 'skill': {
          const groups = await client.listSkills();
          current(signal);
          const failures = groups
            .filter((group) => group.error)
            .map((group) => `${group.dir}: ${group.error}`);
          if (failures.length) throw new Error(failures.join('\n'));
          const seen = new Set<string>();
          return [...groups]
            .sort((a, b) => skillScopeOrder[a.scope] - skillScopeOrder[b.scope])
            .flatMap((group) =>
              group.skills.flatMap((skill) => {
                const token = skillMentionToken(skill);
                if (!token || seen.has(token)) return [];
                seen.add(token);
                const path = group.scope === 'project' ? skill.relativePath : skill.absolutePath;
                return [
                  {
                    id: `${group.scope}:${skill.id}:${skill.relativePath}`,
                    kind,
                    label: `$${token}`,
                    ...(skill.description ? { description: skill.description } : {}),
                    keywords: skill.name,
                    detail: {
                      title: skill.name,
                      description: skill.description,
                      meta: [skillScopeLabels[group.scope]],
                      rows: path ? [{ label: '路径', value: path }] : [],
                    },
                    ...(!path ? { disabledReason: '机器未提供可验证的技能路径。' } : {}),
                    prepare: async (selectionSignal: AbortSignal) => {
                      current(selectionSignal);
                      if (!path) throw new Error('机器未提供可验证的技能路径。');
                      return {
                        text: `$${token}`,
                        expansion: formatSkillMentionPrompt(token, path),
                      };
                    },
                  },
                ];
              }),
            );
        }
        case 'tab': {
          const tabs = await listContextTabs();
          current(signal);
          return tabs.map((tab) => ({
            id: String(tab.id),
            kind,
            label: tab.title,
            description: tab.url,
            detail: { title: tab.title, rows: [{ label: '网址', value: tab.url }] },
            prepare: async (selectionSignal) => {
              current(selectionSignal);
              const context = await capturePage('page', { tabId: tab.id, expectedUrl: tab.url });
              current(selectionSignal);
              return { text: '', context };
            },
          }));
        }
      }
    },
  };
}
