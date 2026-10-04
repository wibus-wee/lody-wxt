import { expect, it } from 'vitest';

import {
  appendDraftFiles,
  clearAttachmentScope,
  loadAttachmentDraft,
  newAttachmentDraft,
  readyAttachments,
  saveAttachmentDraft,
} from '../../src/features/chat/attachment-drafts';

it('retains binary bytes and reserved request identity across reloads without creating a session', async () => {
  const scope = crypto.randomUUID();
  const initial = newAttachmentDraft(`${scope}:new`, scope);
  const draft = await saveAttachmentDraft(
    appendDraftFiles(initial, [new File(['private source'], 'notes.txt', { type: 'text/plain' })]),
  );
  const restored = await loadAttachmentDraft(draft.key);
  expect(restored?.storageSessionId).toBe(initial.storageSessionId);
  expect(restored?.operationId).toBe(initial.operationId);
  expect(await restored?.items[0]?.source.text()).toBe('private source');
  expect(() => readyAttachments(draft)).toThrow('尚未完成上传');
  await clearAttachmentScope(scope);
  expect((await loadAttachmentDraft(draft.key))?.items).toHaveLength(0);
});

it('rejects concurrent overwrites and stale upload completion after scoped deletion', async () => {
  const scope = crypto.randomUUID();
  const initial = newAttachmentDraft(`${scope}:new`, scope);
  const variants = ['a', 'b'].map((name) => appendDraftFiles(initial, [new File([name], name)]));
  const attempts = await Promise.allSettled(variants.map(saveAttachmentDraft));
  expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
  expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
  const stored = (await loadAttachmentDraft(initial.key))!;
  const separate = newAttachmentDraft(`${scope}:other`, `${scope}:other`);
  await saveAttachmentDraft(separate);
  await clearAttachmentScope(scope);
  await expect(saveAttachmentDraft(stored)).rejects.toThrow('另一个窗口改变');
  expect((await loadAttachmentDraft(initial.key))?.items).toHaveLength(0);
  expect(await loadAttachmentDraft(separate.key)).not.toBeNull();
  await clearAttachmentScope(separate.scope);
});

it('rejects empty, oversized and excessive files without changing the existing draft', () => {
  const initial = newAttachmentDraft(crypto.randomUUID(), 'validation');
  expect(() => appendDraftFiles(initial, [new File([], 'empty')])).toThrow('大小不符合');
  expect(() =>
    appendDraftFiles(initial, [
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    ]),
  ).toThrow('大小不符合');
  expect(() =>
    appendDraftFiles(
      initial,
      Array.from({ length: 9 }, (_, i) => new File(['a'], `file${i}`)),
    ),
  ).toThrow('最多');
  expect(initial.items).toHaveLength(0);
});
