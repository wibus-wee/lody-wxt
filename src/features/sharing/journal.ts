import type { PreparedSharePackage, SessionShareView } from '@lody-mobile/sdk';
import { SharePackageManifestSchema, verifyShareObject } from '@lody-mobile/sdk';
import * as v from 'valibot';

const secret = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/));
const shareView = v.object({
  shareId: v.string(),
  rootSessionId: v.string(),
  publisherUserId: v.string(),
  status: v.picklist(['draft', 'active', 'revoked']),
  revision: v.number(),
  credentialVersion: v.number(),
  currentDeploymentId: v.exactOptional(v.string()),
  title: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});
const preparedSchema = v.object({
  manifest: v.pipe(
    v.unknown(),
    v.transform((value) => SharePackageManifestSchema.parse(value)),
  ),
  manifestBytes: v.instance(Uint8Array),
  manifestHash: secret,
  objects: v.map(v.string(), v.instance(Uint8Array)),
  sourceIds: v.array(v.object({ sourceId: v.string(), conversationId: v.string() })),
});
const pendingSchema = v.object({
  origin: v.string(),
  apiOrigin: v.string(),
  rootSessionId: v.string(),
  requestId: v.string(),
  prepared: preparedSchema,
  uploadSecret: secret,
  readerSecret: v.nullable(secret),
  expected: v.nullable(shareView),
  deployment: v.nullable(v.object({ ...shareView.entries, deploymentId: v.string() })),
  sealed: v.boolean(),
  confirmed: v.boolean(),
});
export interface PendingShare {
  origin: string;
  apiOrigin: string;
  rootSessionId: string;
  requestId: string;
  prepared: PreparedSharePackage;
  uploadSecret: string;
  readerSecret: string | null;
  expected: SessionShareView | null;
  deployment: (SessionShareView & { deploymentId: string }) | null;
  sealed: boolean;
  confirmed: boolean;
}
const credentialSchema = v.object({ version: v.number(), secret });
const resetSchema = v.object({
  origin: v.string(),
  apiOrigin: v.string(),
  shareId: v.string(),
  rootSessionId: v.string(),
  expectedRevision: v.number(),
  credentialVersion: v.number(),
  secret,
});
export type PendingShareReset = v.InferOutput<typeof resetSchema>;
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lody-session-shares', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('pending');
      request.result.createObjectStore('credentials');
    };
    request.onerror = () => reject(request.error ?? new Error('无法打开分享存储。'));
    request.onblocked = () => reject(new Error('分享存储被其他窗口占用，请关闭旧版本窗口后重试。'));
    request.onsuccess = () => resolve(request.result);
  }).catch((error: unknown) => {
    database = undefined;
    throw error;
  });
  return database;
}
async function transact(
  store: 'pending' | 'credentials',
  key: string,
  action: 'read' | 'write' | 'delete',
  value?: PendingShare | PendingShareReset | v.InferOutput<typeof credentialSchema>,
) {
  const db = await openDatabase();
  return new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction(store, action === 'read' ? 'readonly' : 'readwrite');
    const objectStore = transaction.objectStore(store);
    const request =
      action === 'read'
        ? objectStore.get(key)
        : action === 'delete'
          ? objectStore.delete(key)
          : objectStore.put(value, key);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? new Error('无法保存分享恢复信息。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('分享恢复信息没有保存。'));
  });
}
export function shareScope(accountKey: string, rootSessionId: string) {
  return JSON.stringify([accountKey, rootSessionId]);
}
export async function readPendingShare(scope: string): Promise<PendingShare | null> {
  const value = await transact('pending', scope, 'read');
  if (value === undefined) return null;
  const pending = v.parse(pendingSchema, value);
  await verifyShareObject(pending.prepared.manifestBytes, {
    id: 'manifest',
    mediaType: 'application/json',
    sizeBytes: pending.prepared.manifestBytes.length,
    sha256: pending.prepared.manifestHash,
  });
  pending.prepared.manifest = SharePackageManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(pending.prepared.manifestBytes)),
  );
  return pending;
}
export async function writePendingShare(scope: string, pending: PendingShare) {
  v.parse(pendingSchema, pending);
  await transact('pending', scope, 'write', pending);
}
export async function clearPendingShare(scope: string) {
  await transact('pending', scope, 'delete');
}
export async function readShareCredential(accountKey: string, shareId: string) {
  const value = await transact('credentials', shareScope(accountKey, shareId), 'read');
  return value === undefined ? null : v.parse(credentialSchema, value);
}
export async function saveShareCredential(
  accountKey: string,
  share: SessionShareView,
  readerSecret: string,
) {
  const previous = await readShareCredential(accountKey, share.shareId);
  if (previous && previous.version > share.credentialVersion)
    throw new Error('此分享的访问密钥已被更新，请重新读取。');
  await transact(
    'credentials',
    shareScope(accountKey, share.shareId),
    'write',
    v.parse(credentialSchema, { version: share.credentialVersion, secret: readerSecret }),
  );
}
export function withShareLock<T>(scope: string, action: () => Promise<T>): Promise<T> {
  return navigator.locks.request(`sharing:${scope}`, action);
}
export async function readPendingReset(scope: string) {
  const value = await transact('credentials', `reset:${scope}`, 'read');
  return value === undefined ? null : v.parse(resetSchema, value);
}
export async function writePendingReset(scope: string, reset: PendingShareReset) {
  await transact('credentials', `reset:${scope}`, 'write', v.parse(resetSchema, reset));
}
export async function clearPendingReset(scope: string) {
  await transact('credentials', `reset:${scope}`, 'delete');
}
