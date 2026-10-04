export const FILE_MAX_BYTES = 100 * 1024 * 1024;
export const FILE_PART_BYTES = 16 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_COUNT = 8;
export const FILE_PREVIEW_BYTES = 1024 * 1024;

export type AttachmentErrorCode =
  | 'invalid_configuration'
  | 'invalid_argument'
  | 'cancelled'
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'invalid_response'
  | 'unauthenticated'
  | 'forbidden'
  | 'integrity_error';

export class AttachmentError extends Error {
  constructor(
    readonly code: AttachmentErrorCode,
    readonly status?: number,
  ) {
    super(`Lody attachment: ${code}`);
    this.name = 'AttachmentError';
  }
}

export class AttachmentCleanupError extends AggregateError {
  constructor(
    // Preserve the original thrown value from injected adapters.
    // ast-grep-ignore: no-unknown-parameter
    readonly transferError: unknown,
    // Preserve cleanup failure alongside the transfer failure.
    // ast-grep-ignore: no-unknown-parameter
    readonly cleanupError: unknown,
  ) {
    super([transferError, cleanupError], 'Attachment transfer and multipart cleanup failed');
    this.name = 'AttachmentCleanupError';
  }
}

const identifier = /^[\w-]{1,128}$/;
const imageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

export interface FileAttachment {
  type: 'file';
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  textPreview: boolean;
  transport: 'r2';
  uploadedAt: number;
  storageSessionId?: string | undefined;
}
export interface ImageAttachment {
  type: 'image';
  imageId: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  fileName?: string | undefined;
  sizeBytes: number;
  width?: number | undefined;
  height?: number | undefined;
  storageSessionId?: string | undefined;
}

export interface AttachmentSource {
  blob: Blob;
  fileName: string;
}
export interface AttachmentLocation {
  workspaceId: string;
  sessionId: string;
}
export interface FileUpload extends AttachmentLocation, AttachmentSource {
  textPreview: boolean;
}
export interface ImageUpload extends AttachmentLocation {
  images: readonly AttachmentSource[];
}
export interface AttachmentDownload extends AttachmentLocation {
  attachmentId: string;
}
export interface FilePreview extends AttachmentDownload {
  sizeBytes: number;
}
export interface FilePreviewResult {
  text: string;
  truncated: boolean;
  fetchedBytes: number;
}
export interface AttachmentProgress {
  phase: 'preparing' | 'uploading' | 'verifying';
  loadedBytes: number;
  totalBytes: number;
}
export interface AttachmentRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (progress: AttachmentProgress) => void;
}

export function validateLocation(location: AttachmentLocation): void {
  if (!identifier.test(location.workspaceId) || !identifier.test(location.sessionId))
    throw new AttachmentError('invalid_argument');
}
export function validateSource(source: AttachmentSource, maxBytes: number): void {
  if (
    !(source.blob instanceof Blob) ||
    source.fileName.length === 0 ||
    !Number.isSafeInteger(source.blob.size) ||
    source.blob.size <= 0 ||
    source.blob.size > maxBytes ||
    source.blob.type.includes('\r') ||
    source.blob.type.includes('\n')
  )
    throw new AttachmentError('invalid_argument');
}
export function validateDownload(input: AttachmentDownload): void {
  validateLocation(input);
  if (!identifier.test(input.attachmentId)) throw new AttachmentError('invalid_argument');
}
export function validateImages(input: ImageUpload): void {
  validateLocation(input);
  if (input.images.length < 1 || input.images.length > IMAGE_MAX_COUNT)
    throw new AttachmentError('invalid_argument');
  for (const image of input.images) {
    validateSource(image, IMAGE_MAX_BYTES);
    const extension = image.fileName.trim().toLowerCase().split('.').slice(1).at(-1);
    if (
      !imageMimeTypes.has(image.blob.type) ||
      (extension !== undefined && !imageExtensions.has(extension))
    )
      throw new AttachmentError('invalid_argument');
  }
}
