import type { MessageActivity } from '../../shared/ui/MessageSurface';
import type { Conversation, ExecutionTarget, Message } from '../connection/client';
import { parseRunConfig } from '../connection/run-config';
import type { PageContext } from '../page-context/model';

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function bounded(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit;
}
export function parseContexts(value: unknown): PageContext[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).flatMap((item: unknown) => {
    const context = record(item);
    if (
      !context ||
      !bounded(context.id, 200) ||
      !bounded(context.title, 200) ||
      !bounded(context.url, 2000) ||
      !bounded(context.text, 12000) ||
      (context.kind !== 'page' && context.kind !== 'selection') ||
      context.trust !== 'untrusted'
    )
      return [];
    try {
      const url = new URL(context.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];
    } catch {
      return [];
    }
    return [
      {
        id: context.id,
        title: context.title,
        url: context.url,
        text: context.text,
        kind: context.kind,
        trust: 'untrusted' as const,
      },
    ];
  });
}
function parseTarget(value: unknown): ExecutionTarget | undefined {
  const target = record(value);
  const project = record(target?.project);
  if (
    !target ||
    !project ||
    !bounded(target.workspaceId, 200) ||
    !bounded(target.machineId, 200) ||
    !bounded(target.agentConfigId, 200)
  )
    return undefined;
  const parsedProject =
    project.kind === 'chat'
      ? { kind: 'chat' as const }
      : project.kind === 'github' && bounded(project.repo, 200)
        ? { kind: 'github' as const, repo: project.repo }
        : undefined;
  if (!parsedProject) return undefined;
  return {
    workspaceId: target.workspaceId,
    machineId: target.machineId,
    agentConfigId: target.agentConfigId,
    project: parsedProject,
  };
}
function parseMessage(value: unknown): Message | undefined {
  const message = record(value);
  if (
    !message ||
    !bounded(message.id, 200) ||
    !bounded(message.text, 32000) ||
    (message.role !== 'user' && message.role !== 'agent') ||
    (message.status !== 'complete' &&
      message.status !== 'streaming' &&
      message.status !== 'stopped' &&
      message.status !== 'failed')
  )
    return undefined;
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    status: message.status,
    contexts: parseContexts(message.contexts),
    inputConfig: parseRunConfig(message.inputConfig),
    createdAt: finiteTimestamp(message.createdAt),
    endedAt: finiteTimestamp(message.endedAt),
    activities: parseActivities(message.activities),
  };
}
function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 8.64e15
    ? value
    : undefined;
}
function parseActivities(value: unknown): MessageActivity[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 100).flatMap((item: unknown) => {
    const activity = record(item);
    if (
      !activity ||
      !bounded(activity.id, 200) ||
      !bounded(activity.title, 500) ||
      (activity.status !== 'running' &&
        activity.status !== 'complete' &&
        activity.status !== 'failed') ||
      (activity.command !== undefined && !bounded(activity.command, 20000)) ||
      (activity.output !== undefined && !bounded(activity.output, 20000))
    )
      return [];
    return [
      {
        id: activity.id,
        title: activity.title,
        status: activity.status,
        command: activity.command as string | undefined,
        output: activity.output as string | undefined,
      },
    ];
  });
}
export function parseConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item: unknown) => {
    const session = record(item);
    const target = parseTarget(session?.target);
    if (
      !session ||
      !target ||
      !bounded(session.id, 200) ||
      !bounded(session.title, 200) ||
      typeof session.updatedAt !== 'number' ||
      !Number.isFinite(session.updatedAt) ||
      !Array.isArray(session.messages) ||
      session.messages.length > 200
    )
      return [];
    const messages = session.messages.map((message: unknown) => parseMessage(message));
    if (messages.some((message) => !message)) return [];
    return [
      {
        id: session.id,
        title: session.title,
        target,
        updatedAt: session.updatedAt,
        messages: messages as Message[],
      },
    ];
  });
}
