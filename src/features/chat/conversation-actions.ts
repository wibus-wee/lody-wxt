import * as v from 'valibot';

import type { ChatAttachment, LodyClient, Message, RunConfig } from '../connection/client';
import { blockSchema } from '../conversations/admission';

const forkSchema = v.object({
  sourceId: v.string(),
  turnId: v.string(),
  operationId: v.string(),
  targetSessionId: v.string(),
});

/** Legacy turns may project an empty config shell; MCP selection alone is not a model choice. */
export function resolveResendConfiguration(
  saved: RunConfig | undefined,
  current: RunConfig | undefined,
) {
  const hasSavedSelection = Boolean(
    saved &&
    (saved.modelId ||
      saved.modeId ||
      saved.reasoningEffort ||
      saved.planMode ||
      saved.fastMode ||
      Object.keys(saved.configOptionValues ?? {}).length),
  );
  if (hasSavedSelection || !current) return { config: saved, usesCurrent: false };
  return {
    config: {
      ...current,
      ...(saved?.mcpServerIds !== undefined ? { mcpServerIds: [...saved.mcpServerIds] } : {}),
    },
    usesCurrent: true,
  };
}

export function messageAttachments(message: Message): ChatAttachment[] {
  const parsed = v.safeParse(v.array(blockSchema), message.turn.inputConfig?.inputBlocks ?? []);
  if (!parsed.success) throw new Error('原消息的附件格式无法读取，不能丢弃附件后重新发送。');
  return parsed.output.filter((block) => block.type !== 'text');
}

export function sameAttachments(
  left: readonly ChatAttachment[],
  right: readonly (ChatAttachment | undefined)[],
) {
  return (
    left.length === right.length &&
    left.every((a, index) => {
      const b = right[index];
      if (
        !b ||
        a.type !== b.type ||
        a.fileName !== b.fileName ||
        a.mimeType !== b.mimeType ||
        a.sizeBytes !== b.sizeBytes ||
        a.storageSessionId !== b.storageSessionId
      )
        return false;
      if (a.type === 'image' && b.type === 'image')
        return a.imageId === b.imageId && a.width === b.width && a.height === b.height;
      if (a.type === 'file' && b.type === 'file')
        return (
          a.fileId === b.fileId &&
          a.sha256 === b.sha256 &&
          a.textPreview === b.textPreview &&
          a.transport === b.transport &&
          a.uploadedAt === b.uploadedAt
        );
      return false;
    })
  );
}

export async function forkConversation(client: LodyClient, sourceId: string, turnId: string) {
  const key = `lody:chat-fork:${client.accountKey}`;
  return navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('另一个窗口正在确认分叉结果，请稍后重试。');
    const saved = localStorage.getItem(key);
    const request = saved
      ? v.parse(forkSchema, JSON.parse(saved))
      : {
          sourceId,
          turnId,
          operationId: crypto.randomUUID(),
          targetSessionId: crypto.randomUUID(),
        };
    if (request.sourceId !== sourceId || request.turnId !== turnId)
      throw new Error('另一条消息的分叉结果尚未确认，请回到原消息再次选择分叉以恢复。');
    localStorage.setItem(key, JSON.stringify(request));
    const result = await client.fork(
      sourceId,
      turnId,
      request.operationId,
      request.targetSessionId,
    );
    await client.open(result.sessionId);
    localStorage.removeItem(key);
    return result.sessionId;
  });
}
