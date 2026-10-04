import type { AttachmentService, SubmissionInputBlock } from '@lody-mobile/sdk';

export async function downloadAttachment(
  service: AttachmentService,
  workspaceId: string,
  sessionId: string,
  block: SubmissionInputBlock,
  signal: AbortSignal,
): Promise<Blob> {
  if (block.type === 'text') throw new Error('Text has no download.');
  const location = {
    workspaceId,
    sessionId,
    attachmentId: block.type === 'file' ? block.fileId : block.imageId,
  };
  return block.type === 'file'
    ? service.downloadFile(location, { signal })
    : service.downloadImage(location, { signal });
}

export function removeAttachment(
  blocks: SubmissionInputBlock[],
  attachmentId: string,
): SubmissionInputBlock[] {
  return blocks.filter(
    (block) =>
      block.type === 'text' ||
      (block.type === 'file' ? block.fileId : block.imageId) !== attachmentId,
  );
}
