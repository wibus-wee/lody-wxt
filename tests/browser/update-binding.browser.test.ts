import { afterEach, expect, it } from 'vitest';

import { verifyInstallationDirectory } from '../../src/features/updates/directory-binding';

let directory: FileSystemDirectoryHandle;
let name: string;
const identity = {
  id: 'a'.repeat(32),
  version: '0.2.4',
  rootUrl: `chrome-extension://${'a'.repeat(32)}/`,
};
async function fixture(version = '0.2.4') {
  name = `binding-${crypto.randomUUID()}`;
  directory = await (
    await navigator.storage.getDirectory()
  ).getDirectoryHandle(name, { create: true });
  const writer = await (
    await directory.getFileHandle('manifest.json', { create: true })
  ).createWritable();
  await writer.write(JSON.stringify({ name: 'Lody', manifest_version: 3, version }));
  await writer.close();
}
async function inventory() {
  const names: string[] = [];
  for await (const key of directory.keys()) names.push(key);
  return names;
}
afterEach(async () => {
  if (name) await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true });
});
it('proves the selected directory with fresh served bytes and removes its temporary marker', async () => {
  await fixture();
  let calls = 0;
  await verifyInstallationDirectory(directory, identity, async (input) => {
    calls++;
    const url = new URL(String(input));
    const file = await (await directory.getFileHandle(url.pathname.slice(1))).getFile();
    const response = new Response(await file.text());
    Object.defineProperty(response, 'url', { value: String(input) });
    return response;
  });
  expect(calls).toBe(1);
  expect(await inventory()).toEqual(['manifest.json']);
});
it('rejects a copied directory that has the same manifest but is not served by the extension', async () => {
  await fixture();
  await expect(
    verifyInstallationDirectory(directory, identity, async (input) => {
      const response = new Response('wrong installation');
      Object.defineProperty(response, 'url', { value: String(input) });
      return response;
    }),
  ).rejects.toThrow('不是当前扩展');
  expect(await inventory()).toEqual(['manifest.json']);
});
it('rejects wrong versions and non-extension identity before requesting a challenge', async () => {
  await fixture('0.2.3');
  await expect(verifyInstallationDirectory(directory, identity)).rejects.toThrow('版本');
  await expect(
    verifyInstallationDirectory(directory, { ...identity, rootUrl: 'https://example.com/' }),
  ).rejects.toThrow('身份');
  expect(await inventory()).toEqual(['manifest.json']);
});
it('cleans up after failed fetches but preserves external replacements of the marker', async () => {
  await fixture();
  await expect(
    verifyInstallationDirectory(directory, identity, async () => {
      throw new Error('offline');
    }),
  ).rejects.toThrow('offline');
  expect(await inventory()).toEqual(['manifest.json']);
  await expect(
    verifyInstallationDirectory(directory, identity, async (input) => {
      const file = await directory.getFileHandle(new URL(String(input)).pathname.slice(1));
      const writer = await file.createWritable();
      await writer.write('external content');
      await writer.close();
      throw new Error('interrupted');
    }),
  ).rejects.toThrow('已保留');
  expect(await inventory()).toHaveLength(2);
});
