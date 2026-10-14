import { afterEach, expect, it } from 'vitest';

import type { Appcast } from '../../src/features/updates/appcast';
import type { UpdateIndex } from '../../src/features/updates/archive';
import { sha256 } from '../../src/features/updates/archive';
import config from '../../src/features/updates/config.json';
import {
  applyDirectoryUpdate,
  directoryUpdateStatus,
  finishDirectoryUpdate,
  prepareDirectoryUpdate,
  rollbackDirectoryUpdate,
} from '../../src/features/updates/directory-transaction';

const encoder = new TextEncoder();
let root: FileSystemDirectoryHandle;
let fixtureName: string;
async function write(path: string, text: string) {
  const handle = await root.getFileHandle(path, { create: true });
  const writer = await handle.createWritable();
  await writer.write(text);
  await writer.close();
}
async function contents(path: string) {
  return (await (await root.getFileHandle(path)).getFile()).text();
}
async function fixture() {
  fixtureName = `update-${crypto.randomUUID()}`;
  root = await (
    await navigator.storage.getDirectory()
  ).getDirectoryHandle(fixtureName, { create: true });
  await write('manifest.json', '{"version":"0.2.4"}');
  await write('keep.txt', 'user file');
  const files = new Map([
    ['manifest.json', encoder.encode('{"version":"0.2.5"}')],
    ['entry.js', encoder.encode('new script')],
  ]);
  let offset = 30;
  const inventory = [];
  for (const [path, bytes] of files) {
    inventory.push({
      path,
      size: bytes.length,
      sha256: await sha256(bytes),
      offset,
      compressedSize: bytes.length,
      compressedSha256: await sha256(bytes),
      method: 0 as const,
    });
    offset += bytes.length;
  }
  const release: Appcast = {
    schemaVersion: 1,
    application: 'lody-wxt',
    channel: 'stable',
    version: '0.2.5',
    releaseNotesUrl: `${config.repository}/releases/tag/v0.2.5`,
    installationUrl: `${config.repository}/releases/download/v0.2.5/INSTALL.md`,
    enclosure: {
      url: `${config.repository}/releases/download/v0.2.5/lody-chrome.zip`,
      length: offset,
      sha256: 'a'.repeat(64),
      type: 'application/zip',
    },
  };
  const index: UpdateIndex = {
    schemaVersion: 1,
    application: 'lody-wxt',
    version: release.version,
    archive: { length: offset, sha256: release.enclosure.sha256 },
    files: inventory,
  };
  return { release, index, files };
}
afterEach(async () => {
  await rollbackDirectoryUpdate();
  if (fixtureName)
    await (await navigator.storage.getDirectory()).removeEntry(fixtureName, { recursive: true });
});

it('uses real browser filesystem and durable IDB backups, then confirms only the loaded version', async () => {
  const { release, index, files } = await fixture();
  await prepareDirectoryUpdate(root, release, index, files);
  expect(await contents('manifest.json')).toBe('{"version":"0.2.4"}');
  expect(await directoryUpdateStatus()).toMatchObject({ phase: 'prepared', changedFiles: 2 });
  await expect(finishDirectoryUpdate('0.2.5')).rejects.toThrow('尚未加载');
  await applyDirectoryUpdate(new AbortController().signal);
  expect(await contents('manifest.json')).toBe('{"version":"0.2.5"}');
  expect(await contents('entry.js')).toBe('new script');
  expect(await contents('keep.txt')).toBe('user file');
  await expect(finishDirectoryUpdate('0.2.4')).rejects.toThrow('尚未加载');
  expect(await directoryUpdateStatus()).toMatchObject({ phase: 'applied' });
  await finishDirectoryUpdate('0.2.5');
  expect(await directoryUpdateStatus()).toBeNull();
});

it('resumes an interrupted partial write from independently reopened IDB state', async () => {
  const { release, index, files } = await fixture();
  await prepareDirectoryUpdate(root, release, index, files);
  // Real disk state at a crash boundary: new script committed, old manifest still installed.
  await write('entry.js', 'new script');
  expect(await contents('manifest.json')).toContain('0.2.4');
  await applyDirectoryUpdate(new AbortController().signal);
  await applyDirectoryUpdate(new AbortController().signal);
  expect(await contents('manifest.json')).toContain('0.2.5');
  await rollbackDirectoryUpdate();
  expect(await contents('manifest.json')).toContain('0.2.4');
  await expect(root.getFileHandle('entry.js')).rejects.toMatchObject({ name: 'NotFoundError' });
  expect(await contents('keep.txt')).toBe('user file');
  expect(await directoryUpdateStatus()).toBeNull();
});

it('keeps a recoverable journal on cancellation and refuses competing preparations', async () => {
  const { release, index, files } = await fixture();
  await prepareDirectoryUpdate(root, release, index, files);
  await expect(prepareDirectoryUpdate(root, release, index, files)).rejects.toThrow('未完成');
  const controller = new AbortController();
  controller.abort();
  await expect(applyDirectoryUpdate(controller.signal)).rejects.toThrow();
  expect(await contents('manifest.json')).toContain('0.2.4');
  expect(await directoryUpdateStatus()).toMatchObject({ phase: 'prepared' });
  await rollbackDirectoryUpdate();
  expect(await directoryUpdateStatus()).toBeNull();
});

it('never overwrites external modifications and retains the recovery data', async () => {
  const { release, index, files } = await fixture();
  await prepareDirectoryUpdate(root, release, index, files);
  await write('manifest.json', 'external edit');
  await expect(applyDirectoryUpdate(new AbortController().signal)).rejects.toThrow('其他程序修改');
  await expect(rollbackDirectoryUpdate()).rejects.toThrow('外部修改');
  expect(await contents('manifest.json')).toBe('external edit');
  expect(await directoryUpdateStatus()).toMatchObject({ phase: 'prepared' });
  // Explicitly restore this test's external edit before requesting normal rollback.
  await write('manifest.json', '{"version":"0.2.4"}');
  await rollbackDirectoryUpdate();
});

it('fails before creating a journal or writing when staged bytes are incomplete or corrupted', async () => {
  const { release, index, files } = await fixture();
  const incomplete = new Map(files);
  incomplete.delete('entry.js');
  await expect(prepareDirectoryUpdate(root, release, index, incomplete)).rejects.toThrow(
    '校验失败',
  );
  incomplete.set('entry.js', encoder.encode('corrupt'));
  await expect(prepareDirectoryUpdate(root, release, index, incomplete)).rejects.toThrow(
    '校验失败',
  );
  expect(await directoryUpdateStatus()).toBeNull();
  expect(await contents('manifest.json')).toContain('0.2.4');
});

it('recovers a newly created empty file left before its atomic write was committed', async () => {
  const { release, index, files } = await fixture();
  await prepareDirectoryUpdate(root, release, index, files);
  await root.getFileHandle('entry.js', { create: true });
  await rollbackDirectoryUpdate();
  await expect(root.getFileHandle('entry.js')).rejects.toMatchObject({ name: 'NotFoundError' });
  expect(await contents('manifest.json')).toContain('0.2.4');
});
