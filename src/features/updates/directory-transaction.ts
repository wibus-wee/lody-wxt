import * as v from 'valibot';

import type { Appcast } from './appcast';
import { appcastSchema } from './appcast';
import type { UpdateIndex } from './archive';
import { parseUpdateIndex, sha256 } from './archive';

const bytesSchema = v.pipe(v.instance(Uint8Array), v.maxLength(64 * 1024 * 1024));
const entrySchema = v.strictObject({
  path: v.string(),
  before: v.nullable(bytesSchema),
  after: bytesSchema,
});
const journalSchema = v.strictObject({
  schema: v.literal(1),
  directory: v.custom<FileSystemDirectoryHandle>(
    (value) =>
      typeof FileSystemDirectoryHandle !== 'undefined' &&
      value instanceof FileSystemDirectoryHandle,
  ),
  release: appcastSchema,
  index: v.unknown(),
  entries: v.pipe(v.array(entrySchema), v.maxLength(10000)),
  phase: v.picklist(['prepared', 'applied']),
});
type Entry = v.InferOutput<typeof entrySchema>;
type Journal = Omit<v.InferOutput<typeof journalSchema>, 'index'> & { index: UpdateIndex };
const lockName = 'lody:directory-update';
// Creating a new file can leave an empty entry if the window closes before close().
// An empty new entry contains no user data; nonempty unexpected files fail closed.
const emptyCreated = (current: Uint8Array | null, entry: Entry) =>
  entry.before === null && current?.length === 0;

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lody-directory-updater', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('journal');
    request.onerror = () => reject(request.error ?? new Error('无法打开更新恢复记录。'));
    request.onblocked = () => reject(new Error('更新恢复存储被旧窗口占用。'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
async function record(action: 'read' | 'write' | 'delete', journal?: Journal) {
  const db = await database();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('journal', action === 'read' ? 'readonly' : 'readwrite', {
        durability: 'strict',
      });
      const store = tx.objectStore('journal');
      const request =
        action === 'read'
          ? store.get('pending')
          : action === 'delete'
            ? store.delete('pending')
            : store.put(journal, 'pending');
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('更新恢复记录未保存，未开始写入。'));
      tx.onerror = () => reject(tx.error ?? new Error('更新恢复存储失败。'));
    });
  } finally {
    db.close();
  }
}
async function pending() {
  const raw = await record('read');
  if (raw === undefined) return null;
  const parsed = v.parse(journalSchema, raw);
  const index = parseUpdateIndex(parsed.index, parsed.release);
  const seen = new Set<string>();
  let size = 0;
  for (const entry of parsed.entries) {
    const file = index.files.find((candidate) => candidate.path === entry.path);
    if (
      !file ||
      seen.has(entry.path) ||
      entry.after.length !== file.size ||
      (await sha256(new Uint8Array(entry.after))) !== file.sha256
    )
      throw new Error('更新恢复记录损坏，未修改安装目录。');
    seen.add(entry.path);
    size += entry.after.length + (entry.before?.length ?? 0);
    if (size > 512 * 1024 * 1024) throw new Error('更新恢复记录超过允许大小。');
  }
  return { ...parsed, index };
}
async function parent(root: FileSystemDirectoryHandle, path: string, create: boolean) {
  const parts = path.split('/');
  const name = parts.pop();
  if (!name) throw new Error('无效的更新文件路径。');
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
  return { directory, name };
}
async function read(root: FileSystemDirectoryHandle, path: string) {
  try {
    const { directory, name } = await parent(root, path, false);
    const file = await (await directory.getFileHandle(name)).getFile();
    if (file.size > 64 * 1024 * 1024) throw new Error(`本地文件过大：${path}`);
    return new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}
async function same(left: Uint8Array | null, right: Uint8Array | null) {
  if (left === null || right === null) return left === right;
  return (
    left.length === right.length &&
    (await sha256(new Uint8Array(left))) === (await sha256(new Uint8Array(right)))
  );
}
async function write(root: FileSystemDirectoryHandle, path: string, bytes: Uint8Array | null) {
  const { directory, name } = await parent(root, path, bytes !== null);
  if (bytes === null) {
    await directory.removeEntry(name);
    return;
  }
  const handle = await directory.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  try {
    await writer.write(new Uint8Array(bytes));
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
}
const ordered = (entries: Entry[]) =>
  [...entries].sort(
    (a, b) =>
      Number(a.path === 'manifest.json') - Number(b.path === 'manifest.json') ||
      a.path.localeCompare(b.path),
  );

// Caller supplies a verified installation directory, never a guessed filesystem path.
// Persist all backups and verified payloads before the first installation write.
export async function prepareDirectoryUpdate(
  directory: FileSystemDirectoryHandle,
  release: Appcast,
  input: UpdateIndex,
  downloaded: ReadonlyMap<string, Uint8Array<ArrayBuffer>>,
) {
  return navigator.locks.request(lockName, async () => {
    if (await pending()) throw new Error('存在未完成的更新，请先恢复。');
    const index = parseUpdateIndex(input, release);
    const entries: Entry[] = [];
    let size = 0;
    for (const file of index.files) {
      const before = await read(directory, file.path);
      if (before && (await sha256(before)) === file.sha256) continue;
      const payload = downloaded.get(file.path);
      if (!payload || payload.length !== file.size || (await sha256(payload)) !== file.sha256)
        throw new Error(`更新文件缺失或校验失败：${file.path}`);
      const after = new Uint8Array(payload);
      size += after.length + (before?.length ?? 0);
      if (size > 512 * 1024 * 1024) throw new Error('更新备份超过允许大小。');
      entries.push({ path: file.path, before, after });
    }
    await record('write', { schema: 1, directory, release, index, entries, phase: 'prepared' });
    return { version: release.version, changedFiles: entries.length };
  });
}

export async function applyDirectoryUpdate(signal: AbortSignal) {
  return navigator.locks.request(lockName, async () => {
    const journal = await pending();
    if (!journal) throw new Error('没有待写入的更新。');
    // Recheck every changed file before writing anything. External edits are never overwritten.
    for (const entry of journal.entries) {
      const current = await read(journal.directory, entry.path);
      if (
        !(await same(current, entry.before)) &&
        !(await same(current, entry.after)) &&
        !emptyCreated(current, entry)
      )
        throw new Error(`安装文件已被其他程序修改：${entry.path}`);
    }
    for (const entry of ordered(journal.entries)) {
      signal.throwIfAborted();
      const current = await read(journal.directory, entry.path);
      if (await same(current, entry.after)) continue;
      if (!(await same(current, entry.before)) && !emptyCreated(current, entry))
        throw new Error(`安装文件发生并发修改：${entry.path}`);
      await write(journal.directory, entry.path, entry.after);
    }
    signal.throwIfAborted();
    await verify(journal);
    await record('write', { ...journal, phase: 'applied' });
    return journal.release.version;
  });
}
async function verify(journal: Journal) {
  for (const file of journal.index.files) {
    const current = await read(journal.directory, file.path);
    if (!current || current.length !== file.size || (await sha256(current)) !== file.sha256)
      throw new Error(`更新后文件校验失败：${file.path}`);
  }
}
export async function rollbackDirectoryUpdate() {
  return navigator.locks.request(lockName, async () => {
    const journal = await pending();
    if (!journal) return;
    for (const entry of journal.entries) {
      const current = await read(journal.directory, entry.path);
      if (
        !(await same(current, entry.before)) &&
        !(await same(current, entry.after)) &&
        !emptyCreated(current, entry)
      )
        throw new Error(`恢复遇到外部修改，已保留备份：${entry.path}`);
    }
    // Restore manifest last, and retain the journal until every restore is verified.
    for (const entry of ordered(journal.entries)) {
      const current = await read(journal.directory, entry.path);
      if (await same(current, entry.before)) continue;
      if (!(await same(current, entry.after)) && !emptyCreated(current, entry))
        throw new Error(`恢复遇到并发修改：${entry.path}`);
      await write(journal.directory, entry.path, entry.before);
    }
    for (const entry of journal.entries)
      if (!(await same(await read(journal.directory, entry.path), entry.before)))
        throw new Error(`恢复校验失败，已保留备份：${entry.path}`);
    await record('delete');
  });
}
export async function finishDirectoryUpdate(installedVersion: string) {
  return navigator.locks.request(lockName, async () => {
    const journal = await pending();
    if (!journal) return;
    if (journal.phase !== 'applied' || journal.release.version !== installedVersion)
      throw new Error('扩展尚未加载已验证的新版本，保留恢复记录。');
    await verify(journal);
    await record('delete');
  });
}
export async function directoryUpdateStatus() {
  return navigator.locks.request(lockName, async () => {
    const journal = await pending();
    return journal
      ? {
          version: journal.release.version,
          phase: journal.phase,
          changedFiles: journal.entries.length,
        }
      : null;
  });
}
