import * as v from 'valibot';

import { directoryUpdateStatus } from './directory-transaction';

export type InstallationIdentity = { id: string; version: string; rootUrl: string };
type WritableDirectory = FileSystemDirectoryHandle & {
  queryPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
};
declare global {
  interface Window {
    showDirectoryPicker?: (options: {
      mode: 'readwrite';
      id: string;
    }) => Promise<WritableDirectory>;
  }
}
const manifestSchema = v.object({
  name: v.literal('Lody'),
  manifest_version: v.literal(3),
  version: v.string(),
});
const bindingSchema = v.strictObject({
  directory: v.instance(FileSystemDirectoryHandle),
  id: v.string(),
});
async function storage(action: 'read' | 'write', binding?: v.InferOutput<typeof bindingSchema>) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lody-directory-binding', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('binding');
    request.onerror = () => reject(request.error ?? new Error('无法打开目录绑定。'));
    request.onblocked = () => reject(new Error('目录绑定存储被旧窗口占用。'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('binding', action === 'read' ? 'readonly' : 'readwrite', {
        durability: 'strict',
      });
      const store = tx.objectStore('binding');
      const request =
        action === 'read' ? store.get('installation') : store.put(binding, 'installation');
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('目录绑定未保存。'));
      tx.onerror = () => reject(tx.error ?? new Error('目录绑定存储失败。'));
    });
  } finally {
    db.close();
  }
}
export function directoryPickerAvailable() {
  return window.showDirectoryPicker !== undefined;
}
// Invoke synchronously from the user's click so the browser keeps transient activation.
export function selectInstallationDirectory() {
  if (!window.showDirectoryPicker) throw new Error('此浏览器不支持目录更新，请使用 ZIP 更新。');
  return window.showDirectoryPicker({ mode: 'readwrite', id: 'lody-installation' });
}
export async function verifyInstallationDirectory(
  directory: FileSystemDirectoryHandle,
  identity: InstallationIdentity,
  request: typeof fetch = globalThis.fetch,
) {
  const origin = new URL(identity.rootUrl);
  if (
    origin.protocol !== 'chrome-extension:' ||
    origin.host !== identity.id ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('无法确认当前扩展身份。');
  const manifestFile = await (await directory.getFileHandle('manifest.json')).getFile();
  if (manifestFile.size > 1024 * 1024) throw new Error('目录中的 manifest 过大。');
  const manifest = v.parse(manifestSchema, JSON.parse(await manifestFile.text()));
  if (manifest.version !== identity.version) throw new Error('所选目录版本与当前扩展不一致。');
  const markerName = `.lody-update-proof-${crypto.randomUUID()}.txt`;
  const marker = crypto.randomUUID();
  // An unpredictable marker proves this is the directory actually served by this extension.
  // A matching manifest alone also accepts a copy or a different installation.
  try {
    await directory.getFileHandle(markerName);
    throw new Error('目录验证文件已存在，请重试。');
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
  }
  const handle = await directory.getFileHandle(markerName, { create: true });
  try {
    const writer = await handle.createWritable();
    try {
      await writer.write(marker);
      await writer.close();
    } catch (error) {
      await writer.abort().catch(() => undefined);
      throw error;
    }
    const url = new URL(markerName, origin).href;
    const response = await request(url, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || response.url !== url || (await response.text()) !== marker)
      throw new Error('所选目录不是当前扩展的安装目录。');
  } finally {
    await removeChallenge(directory, handle, markerName, marker);
  }
}
export async function bindInstallationDirectory(
  directory: FileSystemDirectoryHandle,
  identity: InstallationIdentity,
) {
  return navigator.locks.request('lody:directory-binding', async () => {
    if (await directoryUpdateStatus()) throw new Error('请先恢复未完成的更新，再更换目录。');
    await verifyInstallationDirectory(directory, identity);
    await storage('write', { directory, id: identity.id });
    return directory.name;
  });
}
export async function boundInstallationDirectory(id: string) {
  const raw = await storage('read');
  if (raw === undefined) return null;
  const binding = v.parse(bindingSchema, raw);
  if (binding.id !== id) throw new Error('保存的目录属于另一扩展，请重新绑定。');
  return binding.directory;
}

async function removeChallenge(
  directory: FileSystemDirectoryHandle,
  handle: FileSystemFileHandle,
  name: string,
  marker: string,
) {
  const file = await handle.getFile();
  if (file.size === 0 || (file.size === marker.length && (await file.text()) === marker)) {
    await directory.removeEntry(name);
    return;
  }
  throw new Error('目录验证文件被修改，已保留该文件，请检查所选目录。');
}
