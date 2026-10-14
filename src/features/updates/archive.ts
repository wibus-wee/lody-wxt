import * as v from 'valibot';

import type { Appcast } from './appcast';
import { appcastSchema } from './appcast';

const maxArchive = 256 * 1024 * 1024;
const maxFile = 64 * 1024 * 1024;
const forbiddenPath = /[\\:*?"<>|]/u;
const trailingDotOrSpace = /[ .]$/;
const reservedName = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
const digestSchema = v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/));
const size = (maximum: number) =>
  v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(maximum));
const fileSchema = v.strictObject({
  path: v.pipe(v.string(), v.minLength(1), v.maxLength(512)),
  size: size(maxFile),
  sha256: digestSchema,
  offset: size(maxArchive),
  compressedSize: size(maxArchive),
  compressedSha256: digestSchema,
  method: v.union([v.literal(0), v.literal(8)]),
});
const indexSchema = v.strictObject({
  schemaVersion: v.literal(1),
  application: v.literal('lody-wxt'),
  version: v.string(),
  archive: v.strictObject({ length: size(maxArchive), sha256: digestSchema }),
  files: v.pipe(v.array(fileSchema), v.minLength(1), v.maxLength(10000)),
});
export type UpdateIndex = v.InferOutput<typeof indexSchema>;
export type UpdateFile = UpdateIndex['files'][number];

export function parseUpdateIndex(input: unknown, release: Appcast): UpdateIndex {
  v.parse(appcastSchema, release);
  const index = v.parse(indexSchema, input);
  if (
    index.version !== release.version ||
    index.archive.length !== release.enclosure.length ||
    index.archive.sha256 !== release.enclosure.sha256
  )
    throw new Error('更新索引与已确认的发布包不匹配。');
  const paths = new Set<string>();
  let total = 0;
  for (const file of index.files) {
    const parts = file.path.split('/');
    if (
      new TextEncoder().encode(file.path).length > 512 ||
      forbiddenPath.test(file.path) ||
      Array.from(file.path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      parts.some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          trailingDotOrSpace.test(part) ||
          reservedName.test(part),
      )
    )
      throw new Error('更新索引含不安全的文件路径。');
    const key = file.path.normalize('NFC').toLowerCase();
    if (paths.has(key)) throw new Error('更新索引含重复文件路径。');
    paths.add(key);
    total += file.size;
    if (
      total > 512 * 1024 * 1024 ||
      file.offset < 30 ||
      file.offset + file.compressedSize > index.archive.length ||
      (file.method === 0 && file.size !== file.compressedSize)
    )
      throw new Error('更新索引的文件大小或字节范围无效。');
  }
  for (const path of paths) {
    const parts = path.split('/');
    if (parts.some((_, i) => i > 0 && paths.has(parts.slice(0, i).join('/'))))
      throw new Error('更新索引存在文件与目录冲突。');
  }
  if (!index.files.some((file) => file.path === 'manifest.json'))
    throw new Error('更新索引缺少扩展 manifest。');
  let end = 0;
  for (const file of [...index.files].sort((a, b) => a.offset - b.offset)) {
    if (file.offset < end) throw new Error('更新索引的字节范围重叠。');
    end = file.offset + file.compressedSize;
  }
  return index;
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
  maximum: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream) throw new Error('更新下载没有返回内容。');
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > maximum) throw new Error('更新下载超过允许大小。');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function validateSource(response: Response, requestedUrl: string) {
  if (!response.url) throw new Error('更新下载缺少来源地址。');
  const source = new URL(response.url);
  if (
    source.href !== requestedUrl &&
    (source.origin !== 'https://release-assets.githubusercontent.com' ||
      source.username ||
      source.password)
  )
    throw new Error('更新下载重定向到了未允许的地址。');
}

export async function fetchUpdateIndex(
  release: Appcast,
  signal: AbortSignal,
  request: typeof fetch = globalThis.fetch,
): Promise<UpdateIndex> {
  v.parse(appcastSchema, release);
  const url = new URL('update-index.json', release.enclosure.url).href;
  const response = await request(url, {
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  validateSource(response, url);
  if (!response.ok) throw new Error(`更新索引下载失败：HTTP ${response.status}。`);
  const bytes = await readBounded(response.body, 8 * 1024 * 1024);
  const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return parseUpdateIndex(input, release);
}

async function decodeFile(file: UpdateFile, compressed: Uint8Array<ArrayBuffer>) {
  if (
    compressed.length !== file.compressedSize ||
    (await sha256(compressed)) !== file.compressedSha256
  )
    throw new Error(`压缩文件校验失败：${file.path}`);
  const bytes =
    file.method === 0
      ? compressed
      : await readBounded(
          new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
          file.size,
        );
  if (bytes.length !== file.size || (await sha256(bytes)) !== file.sha256)
    throw new Error(`文件内容校验失败：${file.path}`);
  return bytes;
}

// A 200 response to Range is a full-download fallback, never a partial chunk.
// Nothing here writes the installation. All bytes are verified before handoff.
export async function downloadUpdateFiles(
  release: Appcast,
  input: unknown,
  unchanged: ReadonlyMap<string, string>,
  signal: AbortSignal,
  request: typeof fetch = globalThis.fetch,
): Promise<{ files: Map<string, Uint8Array<ArrayBuffer>>; transferred: number; full: boolean }> {
  const index = parseUpdateIndex(input, release);
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  let archive: Uint8Array<ArrayBuffer> | undefined;
  let transferred = 0;
  const url = release.enclosure.url;
  const get = async (range?: string) => {
    const response = await request(url, {
      credentials: 'omit',
      cache: 'no-store',
      headers: range ? { Range: range } : {},
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    });
    validateSource(response, url);
    return response;
  };
  const acceptFull = async (response: Response) => {
    if (response.status !== 200) throw new Error(`完整更新下载失败：HTTP ${response.status}。`);
    const bytes = await readBounded(response.body, index.archive.length);
    transferred += bytes.length;
    if (bytes.length !== index.archive.length || (await sha256(bytes)) !== index.archive.sha256)
      throw new Error('完整更新包校验失败。');
    return bytes;
  };
  for (const file of index.files) {
    signal.throwIfAborted();
    if (unchanged.get(file.path) === file.sha256) continue;
    let compressed: Uint8Array<ArrayBuffer>;
    if (file.compressedSize === 0) compressed = new Uint8Array();
    else if (archive) compressed = archive.slice(file.offset, file.offset + file.compressedSize);
    else {
      const end = file.offset + file.compressedSize - 1;
      const response = await get(`bytes=${file.offset}-${end}`);
      if (response.status === 200) archive = await acceptFull(response);
      else if (response.status === 416) {
        await response.body?.cancel();
        archive = await acceptFull(await get());
      } else if (response.status === 206) {
        if (
          response.headers.get('Content-Range') !==
          `bytes ${file.offset}-${end}/${index.archive.length}`
        ) {
          await response.body?.cancel();
          throw new Error('增量下载返回了错误的字节范围。');
        }
      } else {
        await response.body?.cancel();
        throw new Error(`增量下载失败：HTTP ${response.status}。`);
      }
      if (archive) compressed = archive.slice(file.offset, file.offset + file.compressedSize);
      else {
        compressed = await readBounded(response.body, file.compressedSize);
        transferred += compressed.length;
      }
    }
    files.set(file.path, await decodeFile(file, compressed));
  }
  return { files, transferred, full: archive !== undefined };
}
