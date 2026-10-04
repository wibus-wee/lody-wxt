import type { SubmissionInputBlock } from '@lody-mobile/sdk';
import { FILE_MAX_BYTES, IMAGE_MAX_BYTES, IMAGE_MAX_COUNT } from '@lody-mobile/sdk';
import * as v from 'valibot';

import { blockSchema } from '../conversations/admission';

const itemSchema = v.object({
  id: v.string(),
  name: v.string(),
  mimeType: v.string(),
  lastModified: v.number(),
  source: v.instance(Blob),
  ready: v.optional(blockSchema),
});
const draftSchema = v.object({
  key: v.string(),
  scope: v.string(),
  storageSessionId: v.string(),
  operationId: v.string(),
  revision: v.number(),
  items: v.array(itemSchema),
});
export type AttachmentDraft = v.InferOutput<typeof draftSchema>;
export type DraftAttachment = v.InferOutput<typeof itemSchema>;
export type ReadyAttachment = Exclude<SubmissionInputBlock, { type: 'text' }>;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lody-chat-attachments', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('drafts', { keyPath: 'key' });
      store.createIndex('scope', 'scope');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('附件存储正在更新，请关闭其他 Lody 扩展页面后重试。'));
  });
}

export function newAttachmentDraft(key: string, scope: string): AttachmentDraft {
  return {
    key,
    scope,
    storageSessionId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    revision: 0,
    items: [],
  };
}

export async function loadAttachmentDraft(key: string): Promise<AttachmentDraft | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('drafts').objectStore('drafts').get(key);
      request.onsuccess = () => {
        const parsed = v.safeParse(v.nullable(draftSchema), request.result ?? null);
        if (parsed.success) resolve(parsed.output);
        else reject(new Error('附件草稿格式无法读取，原始数据已保留。'));
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

// The revision check and write share one transaction so two sidebars cannot overwrite each other.
export async function saveAttachmentDraft(draft: AttachmentDraft): Promise<AttachmentDraft> {
  const database = await openDatabase();
  const next = { ...draft, revision: draft.revision + 1 };
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('drafts', 'readwrite');
      const store = transaction.objectStore('drafts');
      const request = store.get(draft.key);
      let conflict = false;
      request.onsuccess = () => {
        const stored = v.safeParse(v.nullable(draftSchema), request.result ?? null);
        if (!stored.success || (stored.output?.revision ?? 0) !== draft.revision) {
          conflict = true;
          transaction.abort();
        } else store.put(next);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(
          conflict
            ? new Error('附件草稿已在另一个窗口改变，请重新读取后继续。')
            : (transaction.error ?? new Error('附件草稿未能保存。')),
        );
      transaction.onerror = () => reject(transaction.error);
    });
    return next;
  } finally {
    database.close();
  }
}

export function appendDraftFiles(draft: AttachmentDraft, files: readonly File[]): AttachmentDraft {
  const items = files.map((file) => {
    const image = imageTypes.has(file.type);
    if (!file.size || file.size > (image ? IMAGE_MAX_BYTES : FILE_MAX_BYTES))
      throw new Error(`${file.name} 大小不符合附件限制。图片最多 5 MiB，文件最多 100 MiB。`);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
      source: file.slice(),
    };
  });
  const combined = [...draft.items, ...items];
  if (
    combined.filter((item) => imageTypes.has(item.mimeType)).length > IMAGE_MAX_COUNT ||
    combined.filter((item) => !imageTypes.has(item.mimeType)).length > 8
  )
    throw new Error('每条消息最多附加 8 张图片和 8 个文件。');
  return { ...draft, items: combined };
}

export function readyAttachments(draft: AttachmentDraft): ReadyAttachment[] {
  return draft.items.map((item) => {
    if (!item.ready || item.ready.type === 'text') throw new Error(`${item.name} 尚未完成上传。`);
    return item.ready;
  });
}

export async function clearAttachmentScope(scope?: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('drafts', 'readwrite');
      const store = transaction.objectStore('drafts');
      const request =
        scope === undefined ? store.openCursor() : store.index('scope').openCursor(scope);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const value = v.safeParse(draftSchema, cursor.value);
          if (!value.success) cursor.delete();
          else
            cursor.update({
              ...newAttachmentDraft(value.output.key, value.output.scope),
              revision: value.output.revision + 1,
            });
          cursor.continue();
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
