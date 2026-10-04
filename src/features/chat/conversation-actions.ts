import * as v from 'valibot';

import type { ChatAttachment, Conversation, LodyClient, Message } from '../connection/client';
import { blockSchema } from '../conversations/admission';

const filenameUnsafe = /[^\p{L}\p{N} _-]/gu;
const forkSchema = v.object({
  sourceId: v.string(),
  turnId: v.string(),
  operationId: v.string(),
  targetSessionId: v.string(),
});

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

export function exportConversation(conversation: Conversation) {
  const markdown = [
    `# ${conversation.title}`,
    ...conversation.messages.map((message) =>
      [
        `## ${message.role === 'user' ? '你' : message.role === 'agent' ? 'Lody' : '系统'}`,
        message.text,
        ...(message.role === 'user'
          ? messageAttachments(message).map(
              (attachment) =>
                `附件：${attachment.fileName ?? '图片'}（${attachment.mimeType}，${attachment.sizeBytes} 字节；导出仅包含描述，文件需在会话中下载）`,
            )
          : []),
        ...message.contexts.map(
          (context) => `来源：${context.title}\n${context.url}\n\n${context.text}`,
        ),
      ].join('\n\n'),
    ),
  ].join('\n\n');
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${conversation.title.replace(filenameUnsafe, '_').slice(0, 100) || 'Lody'}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function searchConversations(
  client: LodyClient,
  query: string,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
) {
  const rows = await client.list();
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { ids: rows.map((row) => row.id), failed: [] as string[] };
  const ids: string[] = [];
  const failed: string[] = [];
  for (const [index, row] of rows.entries()) {
    signal.throwIfAborted();
    try {
      const conversation = await client.readConversation(row.id);
      signal.throwIfAborted();
      const content = [
        conversation.title,
        ...conversation.messages.flatMap((message) => [
          message.text,
          ...message.contexts.map((context) => context.text),
          ...message.activities.flatMap((activity) => [
            activity.title,
            activity.command ?? '',
            activity.output ?? '',
          ]),
        ]),
      ].join('\n');
      if (content.toLocaleLowerCase().includes(needle)) ids.push(row.id);
    } catch (error) {
      signal.throwIfAborted();
      failed.push(`${row.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
    progress(index + 1, rows.length);
  }
  return { ids, failed };
}
