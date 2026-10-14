import { expect, it } from 'vitest';

import type { Appcast } from '../../src/features/updates/appcast';
import type { UpdateFile, UpdateIndex } from '../../src/features/updates/archive';
import {
  downloadUpdateFiles,
  fetchUpdateIndex,
  parseUpdateIndex,
  sha256,
} from '../../src/features/updates/archive';
import config from '../../src/features/updates/config.json';

async function fixture() {
  const manifest = new TextEncoder().encode('{"name":"Lody","version":"0.2.5"}');
  const script = new TextEncoder().encode('console.log("updated")');
  const compressed = new Uint8Array(
    await new Response(
      new Blob([script]).stream().pipeThrough(new CompressionStream('deflate-raw')),
    ).arrayBuffer(),
  );
  const archive = new Uint8Array(30 + manifest.length + compressed.length);
  archive.set(manifest, 30);
  archive.set(compressed, 30 + manifest.length);
  const files: UpdateFile[] = [
    {
      path: 'manifest.json',
      size: manifest.length,
      sha256: await sha256(manifest),
      offset: 30,
      compressedSize: manifest.length,
      compressedSha256: await sha256(manifest),
      method: 0,
    },
    {
      path: 'entry.js',
      size: script.length,
      sha256: await sha256(script),
      offset: 30 + manifest.length,
      compressedSize: compressed.length,
      compressedSha256: await sha256(compressed),
      method: 8,
    },
  ];
  const release: Appcast = {
    schemaVersion: 1,
    application: 'lody-wxt',
    channel: 'stable',
    version: '0.2.5',
    releaseNotesUrl: `${config.repository}/releases/tag/v0.2.5`,
    installationUrl: `${config.repository}/releases/download/v0.2.5/INSTALL.md`,
    enclosure: {
      url: `${config.repository}/releases/download/v0.2.5/lody-chrome.zip`,
      length: archive.length,
      sha256: await sha256(archive),
      type: 'application/zip',
    },
  };
  const index: UpdateIndex = {
    schemaVersion: 1,
    application: 'lody-wxt',
    version: release.version,
    archive: { length: archive.length, sha256: release.enclosure.sha256 },
    files,
  };
  return { release, index, archive, manifest, script };
}
function reply(bytes: Uint8Array<ArrayBuffer> | string, url: string, status = 200, headers = {}) {
  const response = new Response(bytes, { status, headers });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}
const signal = () => new AbortController().signal;

it('validates version, archive identity, paths, collision and range bounds before requests', async () => {
  const { release, index } = await fixture();
  expect(parseUpdateIndex(index, release).files).toHaveLength(2);
  for (const path of [
    '../escape',
    '/absolute',
    'a\\b',
    'CON.txt',
    'a/./b',
    'a/../b',
    'trailing.',
    'a//b',
  ]) {
    expect(() =>
      parseUpdateIndex({ ...index, files: [...index.files, { ...index.files[1], path }] }, release),
    ).toThrow();
  }
  for (const changed of [
    { ...index, version: '0.2.6' },
    { ...index, archive: { ...index.archive, sha256: '0'.repeat(64) } },
    { ...index, files: [...index.files, { ...index.files[1], path: 'ENTRY.JS' }] },
    { ...index, files: [...index.files, { ...index.files[1], path: 'entry.js/child' }] },
    { ...index, files: [index.files[0], { ...index.files[1], offset: 30 }] },
    { ...index, files: [index.files[0], { ...index.files[1], offset: 999999 }] },
    { ...index, files: [index.files[1]] },
  ])
    expect(() => parseUpdateIndex(changed, release)).toThrow();
});

it('downloads only changed ranges and verifies native browser decompression and both hashes', async () => {
  const { release, index, archive, manifest, script } = await fixture();
  const calls: RequestInit[] = [];
  const request: typeof fetch = async (url, init) => {
    if (init) calls.push(init);
    const range = new Headers(init?.headers).get('Range');
    expect(range).toBe(`bytes=${30 + manifest.length}-${archive.length - 1}`);
    return reply(archive.slice(30 + manifest.length), String(url), 206, {
      'Content-Range': `bytes ${30 + manifest.length}-${archive.length - 1}/${archive.length}`,
    });
  };
  const result = await downloadUpdateFiles(
    release,
    index,
    new Map([['manifest.json', await sha256(manifest)]]),
    signal(),
    request,
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ credentials: 'omit', cache: 'no-store' });
  expect(result.files.get('entry.js')).toEqual(script);
  expect(result.files.has('manifest.json')).toBe(false);
  expect(result.full).toBe(false);
  expect(result.transferred).toBe(archive.length - 30 - manifest.length);
});

it('uses a range-ignored 200 exactly once as a verified full archive', async () => {
  const { release, index, archive, manifest, script } = await fixture();
  let calls = 0;
  const result = await downloadUpdateFiles(release, index, new Map(), signal(), async (url) => {
    calls++;
    return reply(archive, String(url));
  });
  expect(calls).toBe(1);
  expect(result).toMatchObject({ full: true, transferred: archive.length });
  expect(result.files.get('manifest.json')).toEqual(manifest);
  expect(result.files.get('entry.js')).toEqual(script);
});

it('falls back on 416, but never accepts truncated or hash-mismatched full bytes', async () => {
  const { release, index, archive } = await fixture();
  let calls = 0;
  const result = await downloadUpdateFiles(
    release,
    index,
    new Map(),
    signal(),
    async (url, init) => {
      calls++;
      return new Headers(init?.headers).has('Range')
        ? reply('', String(url), 416)
        : reply(archive, String(url));
    },
  );
  expect(result.full).toBe(true);
  expect(calls).toBe(2);
  for (const bytes of [
    archive.slice(1),
    new Uint8Array(archive.length),
    new Uint8Array(archive.length + 1),
  ]) {
    await expect(
      downloadUpdateFiles(release, index, new Map(), signal(), async (url) =>
        reply(bytes, String(url)),
      ),
    ).rejects.toThrow();
  }
});

it('rejects wrong partial ranges, corrupt payloads, foreign redirects and aborted operations', async () => {
  const { release, index, archive } = await fixture();
  for (const response of [
    reply(archive.slice(30), release.enclosure.url, 206, { 'Content-Range': 'bytes 0-1/2' }),
    reply(archive, 'https://untrusted.test/archive.zip'),
    reply('', release.enclosure.url, 503),
  ])
    await expect(
      downloadUpdateFiles(release, index, new Map(), signal(), async () => response),
    ).rejects.toThrow();
  const file = index.files[0];
  if (!file) throw new Error('Missing fixture');
  await expect(
    downloadUpdateFiles(release, index, new Map(), signal(), async (url) =>
      reply(new Uint8Array(file.compressedSize), String(url), 206, {
        'Content-Range': `bytes ${file.offset}-${file.offset + file.compressedSize - 1}/${archive.length}`,
      }),
    ),
  ).rejects.toThrow('压缩文件校验失败');
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await expect(
    downloadUpdateFiles(release, index, new Map(), controller.signal, async (url) => {
      calls++;
      return reply(archive, String(url));
    }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});

it('reads only the version-pinned optional sidecar without changing legacy appcast', async () => {
  const { release, index } = await fixture();
  const result = await fetchUpdateIndex(release, signal(), async (url, init) => {
    expect(String(url)).toBe(`${config.repository}/releases/download/v0.2.5/update-index.json`);
    expect(init?.credentials).toBe('omit');
    return reply(JSON.stringify(index), String(url));
  });
  expect(result.version).toBe(release.version);
  await expect(
    fetchUpdateIndex(release, signal(), async (url) => reply('', String(url), 404)),
  ).rejects.toThrow('404');
});
