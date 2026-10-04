import * as v from 'valibot';

import type { AttachmentGateway } from '../application/attachment-service.js';
import { AttachmentService } from '../application/attachment-service.js';
import type {
  AttachmentDownload,
  AttachmentLocation,
  AttachmentRequestOptions,
  FileAttachment,
  FilePreview,
  FilePreviewResult,
  FileUpload,
  ImageAttachment,
  ImageUpload,
} from '../domain/attachments.js';
import {
  AttachmentCleanupError,
  AttachmentError,
  FILE_MAX_BYTES,
  FILE_PART_BYTES,
  FILE_PREVIEW_BYTES,
  IMAGE_MAX_BYTES,
} from '../domain/attachments.js';
import { fileAttachmentSchema, imageAttachmentSchema } from './attachment-schemas.js';
import { IncrementalSha256 } from './incremental-sha256.js';

export interface AttachmentAuth {
  getToken: (signal?: AbortSignal) => Promise<string>;
}
export interface AttachmentFetch {
  (url: string, init: RequestInit): Promise<Response>;
}
export interface AttachmentClientOptions {
  origin: string;
  auth: AttachmentAuth;
  fetch?: AttachmentFetch;
  timeoutMs?: number;
  cleanupTimeoutMs?: number;
}
interface TransferContext {
  signal: AbortSignal;
  token: string;
}
const identifier = v.pipe(v.string(), v.regex(/^[\w-]{1,128}$/));
const createSchema = v.object({ uploadId: v.pipe(v.string(), v.minLength(1)), fileId: identifier });
const partSchema = v.object({ etag: v.pipe(v.string(), v.minLength(1)) });
const fileResponseSchema = v.union([
  v.object({ file: fileAttachmentSchema }),
  fileAttachmentSchema,
]);
const imageResponseSchema = v.object({ image: imageAttachmentSchema });

function duration(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647)
    throw new AttachmentError('invalid_configuration');
  return value;
}
function base(input: AttachmentLocation, kind: 'files' | 'images'): string {
  return `/api/workspaces/${encodeURIComponent(input.workspaceId)}/session-${kind}`;
}
function downloadPath(input: AttachmentDownload, kind: 'files' | 'images'): string {
  return `${base(input, kind)}/${encodeURIComponent(input.sessionId)}/${encodeURIComponent(input.attachmentId)}`;
}
function decodeFile(value: unknown): FileAttachment {
  const parsed = v.safeParse(fileResponseSchema, value);
  if (!parsed.success) throw new AttachmentError('invalid_response');
  return v.is(fileAttachmentSchema, parsed.output) ? parsed.output : parsed.output.file;
}

export class HttpAttachmentGateway implements AttachmentGateway {
  private readonly origin: string;
  private readonly fetch: AttachmentFetch;
  private readonly timeoutMs: number;
  private readonly cleanupTimeoutMs: number;

  constructor(private readonly options: AttachmentClientOptions) {
    try {
      const url = new URL(options.origin);
      if (
        url.protocol !== 'https:' ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      )
        throw new AttachmentError('invalid_configuration');
      this.origin = url.origin;
    } catch {
      throw new AttachmentError('invalid_configuration');
    }
    this.fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.timeoutMs = duration(options.timeoutMs ?? 30_000);
    this.cleanupTimeoutMs = duration(options.cleanupTimeoutMs ?? 5_000);
  }

  private async scope<T>(
    options: AttachmentRequestOptions,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const timeoutMs = duration(options.timeoutMs ?? this.timeoutMs);
    if (options.signal?.aborted) throw new AttachmentError('cancelled');
    const controller = new AbortController();
    let failure: AttachmentError | undefined;
    let rejectAbort!: (reason: AttachmentError) => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const stop = (code: 'cancelled' | 'timeout') => {
      failure ??= new AttachmentError(code);
      controller.abort(failure);
      rejectAbort(failure);
    };
    const cancel = () => stop('cancelled');
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(stop, timeoutMs, 'timeout');
    const running = operation(controller.signal);
    try {
      return await Promise.race([running, aborted]);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    }
  }

  private async context(signal: AbortSignal): Promise<TransferContext> {
    const token = await this.options.auth.getToken(signal);
    signal.throwIfAborted();
    if (!token.trim() || token.includes('\r') || token.includes('\n'))
      throw new AttachmentError('unauthenticated');
    return { signal, token };
  }

  private async request(
    path: string,
    init: RequestInit,
    context: TransferContext,
  ): Promise<Response> {
    context.signal.throwIfAborted();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${context.token}`);
    let response: Response;
    try {
      response = await this.fetch(`${this.origin}${path}`, {
        ...init,
        headers,
        signal: context.signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      });
    } catch {
      context.signal.throwIfAborted();
      throw new AttachmentError('network_error');
    }
    context.signal.throwIfAborted();
    if (response.status === 401) throw new AttachmentError('unauthenticated', 401);
    if (response.status === 403) throw new AttachmentError('forbidden', 403);
    if (!response.ok) throw new AttachmentError('http_error', response.status);
    return response;
  }

  private async json(response: Response, signal: AbortSignal): Promise<unknown> {
    try {
      const value: unknown = await response.json();
      signal.throwIfAborted();
      return value;
    } catch {
      signal.throwIfAborted();
      throw new AttachmentError('invalid_response', response.status);
    }
  }

  private async hash(
    input: FileUpload,
    signal: AbortSignal,
    options: AttachmentRequestOptions,
  ): Promise<string> {
    const hash = new IncrementalSha256();
    options.onProgress?.({ phase: 'preparing', loadedBytes: 0, totalBytes: input.blob.size });
    for (let offset = 0; offset < input.blob.size; offset += 4 * 1024 * 1024) {
      signal.throwIfAborted();
      const end = Math.min(offset + 4 * 1024 * 1024, input.blob.size);
      const bytes = await input.blob.slice(offset, end).arrayBuffer();
      signal.throwIfAborted();
      hash.update(new Uint8Array(bytes));
      options.onProgress?.({ phase: 'preparing', loadedBytes: end, totalBytes: input.blob.size });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return hash.digestHex();
  }

  uploadFile = async (
    input: FileUpload,
    options: AttachmentRequestOptions = {},
  ): Promise<FileAttachment> => {
    let multipart: { uploadId: string; fileId: string; token: string } | undefined;
    try {
      return await this.scope(options, async (signal) => {
        const context = await this.context(signal);
        const sha256 = await this.hash(input, signal, options);
        const headers = {
          'x-session-id': input.sessionId,
          'x-file-name': encodeURIComponent(input.fileName),
          'x-file-mime-type': input.blob.type || 'application/octet-stream',
          'x-file-sha256': sha256,
          'x-file-size-bytes': String(input.blob.size),
          'x-file-text-preview': String(input.textPreview),
        };
        const path = base(input, 'files');
        options.onProgress?.({ phase: 'uploading', loadedBytes: 0, totalBytes: input.blob.size });
        let response: Response;
        if (input.blob.size <= FILE_PART_BYTES) {
          response = await this.request(
            `${path}/upload`,
            { method: 'POST', headers, body: input.blob },
            context,
          );
        } else {
          const created = await this.request(
            `${path}/multipart/create`,
            { method: 'POST', headers },
            context,
          );
          const parsed = v.safeParse(createSchema, await this.json(created, signal));
          if (!parsed.success) throw new AttachmentError('invalid_response');
          multipart = { ...parsed.output, token: context.token };
          const uploadPath = `${path}/multipart/${encodeURIComponent(parsed.output.uploadId)}`;
          const identity = { 'x-session-id': input.sessionId, 'x-file-id': parsed.output.fileId };
          const parts: { partNumber: number; etag: string }[] = [];
          for (let start = 0; start < input.blob.size; start += FILE_PART_BYTES) {
            const partNumber = parts.length + 1;
            const blob = input.blob.slice(start, start + FILE_PART_BYTES);
            const uploaded = await this.request(
              `${uploadPath}/part/${partNumber}`,
              {
                method: 'PUT',
                headers: { ...identity, 'x-file-part-size-bytes': String(blob.size) },
                body: blob,
              },
              context,
            );
            const part = v.safeParse(partSchema, await this.json(uploaded, signal));
            if (!part.success) throw new AttachmentError('invalid_response');
            parts.push({ partNumber, etag: part.output.etag });
            options.onProgress?.({
              phase: 'uploading',
              loadedBytes: start + blob.size,
              totalBytes: input.blob.size,
            });
          }
          options.onProgress?.({
            phase: 'verifying',
            loadedBytes: input.blob.size,
            totalBytes: input.blob.size,
          });
          response = await this.request(
            `${uploadPath}/complete`,
            {
              method: 'POST',
              headers: { ...identity, 'Content-Type': 'application/json' },
              body: JSON.stringify({ parts }),
            },
            context,
          );
        }
        const payload = decodeFile(await this.json(response, signal));
        if (
          payload.sha256 !== sha256 ||
          payload.sizeBytes !== input.blob.size ||
          (multipart !== undefined && payload.fileId !== multipart.fileId)
        )
          throw new AttachmentError('integrity_error');
        options.onProgress?.({
          phase: 'verifying',
          loadedBytes: input.blob.size,
          totalBytes: input.blob.size,
        });
        return payload;
      });
    } catch (error) {
      if (multipart !== undefined) {
        const upload = multipart;
        try {
          await this.scope({ timeoutMs: this.cleanupTimeoutMs }, async (signal) => {
            await this.request(
              `${base(input, 'files')}/multipart/${encodeURIComponent(upload.uploadId)}`,
              {
                method: 'DELETE',
                headers: { 'x-session-id': input.sessionId, 'x-file-id': upload.fileId },
              },
              { signal, token: upload.token },
            );
          });
        } catch (cleanupError) {
          throw new AttachmentCleanupError(error, cleanupError);
        }
      }
      throw error;
    }
  };

  uploadImages = async (
    input: ImageUpload,
    options: AttachmentRequestOptions = {},
  ): Promise<ImageAttachment[]> =>
    this.scope(options, async (signal) => {
      const context = await this.context(signal);
      const images: ImageAttachment[] = [];
      let loadedBytes = 0;
      const totalBytes = input.images.reduce((total, image) => total + image.blob.size, 0);
      for (const source of input.images) {
        const form = new FormData();
        form.set('sessionId', input.sessionId);
        form.set('file', source.blob, source.fileName);
        const response = await this.request(
          `${base(input, 'images')}/upload`,
          { method: 'POST', body: form },
          context,
        );
        const parsed = v.safeParse(imageResponseSchema, await this.json(response, signal));
        if (!parsed.success) throw new AttachmentError('invalid_response');
        if (parsed.output.image.sizeBytes !== source.blob.size)
          throw new AttachmentError('integrity_error');
        images.push(parsed.output.image);
        loadedBytes += source.blob.size;
        options.onProgress?.({ phase: 'uploading', loadedBytes, totalBytes });
      }
      return images;
    });

  private async bytes(
    response: Response,
    maxBytes: number,
    signal: AbortSignal,
    prefix = false,
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (response.body === null) throw new AttachmentError('invalid_response', response.status);
    const reader = response.body.getReader();
    let cancellation: Promise<void> | undefined;
    const cancel = () => {
      cancellation ??= reader.cancel();
    };
    signal.addEventListener('abort', cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (let read = 0; read <= maxBytes; read++) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        const remaining = maxBytes - total;
        if (!prefix && chunk.value.byteLength > remaining)
          throw new AttachmentError('invalid_response', response.status);
        const value = chunk.value.subarray(0, remaining);
        chunks.push(value);
        total += value.byteLength;
        if (prefix && total === maxBytes) break;
        if (read === maxBytes) throw new AttachmentError('invalid_response', response.status);
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      try {
        await (cancellation ?? reader.cancel());
      } finally {
        reader.releaseLock();
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  private async download(
    input: AttachmentDownload,
    kind: 'files' | 'images',
    options: AttachmentRequestOptions,
  ): Promise<Blob> {
    return this.scope(options, async (signal) => {
      const context = await this.context(signal);
      const response = await this.request(downloadPath(input, kind), { method: 'GET' }, context);
      const bytes = await this.bytes(
        response,
        kind === 'files' ? FILE_MAX_BYTES : IMAGE_MAX_BYTES,
        signal,
      );
      return new Blob([bytes], { type: response.headers.get('Content-Type') ?? '' });
    });
  }
  downloadFile = async (
    input: AttachmentDownload,
    options: AttachmentRequestOptions = {},
  ): Promise<Blob> => this.download(input, 'files', options);
  downloadImage = async (
    input: AttachmentDownload,
    options: AttachmentRequestOptions = {},
  ): Promise<Blob> => this.download(input, 'images', options);
  previewFile = async (
    input: FilePreview,
    options: AttachmentRequestOptions = {},
  ): Promise<FilePreviewResult> =>
    this.scope(options, async (signal) => {
      const context = await this.context(signal);
      const response = await this.request(
        `${downloadPath(input, 'files')}/preview`,
        {
          method: 'GET',
          headers: { Range: `bytes=0-${FILE_PREVIEW_BYTES - 1}` },
        },
        context,
      );
      const bytes = await this.bytes(response, FILE_PREVIEW_BYTES, signal, true);
      return {
        text: new TextDecoder().decode(bytes),
        fetchedBytes: bytes.byteLength,
        truncated:
          input.sizeBytes > 0
            ? input.sizeBytes > bytes.byteLength
            : bytes.byteLength === FILE_PREVIEW_BYTES,
      };
    });
}

export function createAttachmentClient(options: AttachmentClientOptions): AttachmentService {
  return new AttachmentService(new HttpAttachmentGateway(options));
}
