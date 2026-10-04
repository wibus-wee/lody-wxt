import * as v from 'valibot';

import type { PreparedSharePackage } from '../domain/models.js';
import { decodeShareHistoryBytes } from './share-codec.js';
import { mapShareConcurrent } from './share-concurrency.js';
import {
  assertShareAttachmentPolicy,
  SHARE_LIMITS,
  shareObjectDigest,
  SharePackageManifestSchema,
  ShareResourceId,
  validateShareHistory,
  verifyShareObject,
} from './share-package.js';

const lengthPattern = /^\d+$/;
const secretPattern = /^[a-f0-9]{64}$/;
const agentPathPattern = /^\/api\/share-agent\/[\w.-]{1,2048}$/;
function resolveResponse(value: unknown) {
  const result = v.parse(
    v.strictObject({ shareId: v.string(), deploymentId: v.string(), manifest: v.unknown() }),
    value,
  );
  return {
    shareId: ShareResourceId.parse(result.shareId),
    deploymentId: ShareResourceId.parse(result.deploymentId),
    manifest: SharePackageManifestSchema.parse(result.manifest),
  };
}

/** Does not use the app fetch client: workspace credentials must never join these requests. */
function shareApiOrigin(origin: string): string {
  const url = new URL(origin);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
  )
    throw new Error('Invalid share API origin');
  return url.origin;
}

export async function readShareResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('Share unavailable');
  }
  const length = response.headers.get('Content-Length');
  if (length !== null && (!lengthPattern.test(length) || Number(length) > maxBytes)) {
    await response.body.cancel();
    throw new Error('Share object exceeds size limit');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    let result = await reader.read();
    while (!result.done) {
      total += result.value.byteLength;
      if (total > maxBytes) throw new Error('Share object exceeds size limit');
      chunks.push(result.value);
      result = await reader.read();
    }
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error('Share object read failed');
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function readJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Invalid share JSON');
  }
}

function shareFetch(options: {
  origin: string;
  secret: string;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}) {
  const origin = shareApiOrigin(options.origin);
  if (!secretPattern.test(options.secret)) throw new Error('Invalid share credential');
  return async (path: string, init?: RequestInit) => {
    const signal = AbortSignal.any([
      AbortSignal.timeout(120_000),
      ...(options.signal ? [options.signal] : []),
      ...(init?.signal ? [init.signal] : []),
    ]);
    signal.throwIfAborted();
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${options.secret}`);
    const response = await (options.fetch ?? globalThis.fetch)(`${origin}${path}`, {
      ...init,
      signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Share unavailable');
    }
    return response;
  };
}

/** Resolve once; every subsequent read is fixed to this deployment, never current again. */
export async function openStaticShare(options: {
  origin: string;
  shareId: string;
  secret: string;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}) {
  const shareId = ShareResourceId.parse(options.shareId);
  const request = shareFetch(options);
  const resolved = resolveResponse(
    readJson(
      await readShareResponseBytes(
        await request(`/api/shares/${shareId}`),
        SHARE_LIMITS.manifestBytes + 1024,
      ),
    ),
  );
  if (resolved.shareId !== shareId) throw new Error('Invalid share identity');
  const prefix = `/api/shares/${shareId}/deployments/${resolved.deploymentId}/objects/`;
  const inventory = new Map(resolved.manifest.objects.map((entry) => [entry.id, entry]));
  async function readObject(objectId: string, signal?: AbortSignal) {
    const descriptor = inventory.get(objectId);
    if (!descriptor) throw new Error('Share object unavailable');
    const bytes = await readShareResponseBytes(
      await request(`${prefix}${descriptor.id}`, signal ? { signal } : undefined),
      descriptor.sizeBytes,
    );
    await verifyShareObject(bytes, descriptor);
    return bytes;
  }
  return {
    ...resolved,
    async createAgentAccess(conversationId: string) {
      if (!resolved.manifest.conversations.some((c) => c.id === conversationId))
        throw new Error('Share conversation unavailable');
      const response = await request(
        `/api/shares/${shareId}/deployments/${resolved.deploymentId}/agent/${conversationId}`,
        { method: 'POST' },
      );
      const link = v.parse(
        v.strictObject({
          url: v.pipe(v.string(), v.url()),
          expiresAt: v.pipe(v.string(), v.isoTimestamp()),
        }),
        readJson(await readShareResponseBytes(response, 4096)),
      );
      const url = new URL(link.url);
      if (
        url.origin !== shareApiOrigin(options.origin) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !agentPathPattern.test(url.pathname)
      )
        throw new Error('Invalid share agent URL');
      return link;
    },
    readObject,
    async readHistory(conversationId: string, signal?: AbortSignal) {
      const conversation = resolved.manifest.conversations.find(
        (entry) => entry.id === conversationId,
      );
      if (!conversation) throw new Error('Share conversation unavailable');
      const bytes = await readObject(conversation.historyObjectId, signal);
      return validateShareHistory(
        readJson(
          await decodeShareHistoryBytes(bytes, inventory.get(conversation.historyObjectId)!),
        ),
      );
    },
    async readAttachment(attachmentId: string, signal?: AbortSignal) {
      const attachment = resolved.manifest.attachments.find((entry) => entry.id === attachmentId);
      if (!attachment) throw new Error('Share attachment unavailable');
      const object = inventory.get(attachment.objectId)!;
      return {
        ...attachment,
        mediaType: object.mediaType,
        bytes: await readObject(object.id, signal),
      };
    },
  };
}

/** Upload capability cannot publish: the authenticated app commits only after sealing. */
export async function uploadPreparedShare(options: {
  origin: string;
  deploymentId: string;
  secret: string;
  prepared: PreparedSharePackage;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}): Promise<void> {
  const manifestBytes = options.prepared.manifestBytes.slice();
  if (
    manifestBytes.length > SHARE_LIMITS.manifestBytes ||
    (await shareObjectDigest(manifestBytes)) !== options.prepared.manifestHash
  )
    throw new Error('Share manifest hash mismatch');
  const manifest = SharePackageManifestSchema.parse(readJson(manifestBytes));
  assertShareAttachmentPolicy(manifest);
  const objects = new Map(
    Array.from(options.prepared.objects, ([id, bytes]) => [id, bytes.slice()]),
  );
  const deploymentId = ShareResourceId.parse(options.deploymentId);
  const request = shareFetch(options);
  const totalBytes = manifest.objects.reduce((total, object) => total + object.sizeBytes, 0);
  let uploadedBytes = 0;
  await mapShareConcurrent(
    manifest.objects,
    async (object, _index, signal) => {
      const bytes = objects.get(object.id);
      if (!bytes) throw new Error('Incomplete share package');
      await verifyShareObject(bytes, object);
      const response = await request(
        `/api/share-deployments/${deploymentId}/objects/${object.id}`,
        {
          method: 'PUT',
          signal,
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes.slice().buffer,
        },
      );
      await response.body?.cancel();
      uploadedBytes += object.sizeBytes;
      options.onProgress?.(uploadedBytes, totalBytes);
    },
    options.signal,
  );
  const response = await request(`/api/share-deployments/${deploymentId}/seal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: manifestBytes.slice().buffer,
  });
  await response.body?.cancel();
}
