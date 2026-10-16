import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const pickerTitle = /^(?:Select|Open|Choose)/;
const key = (...keys) => execFileSync('xdotool', ['key', '--clearmodifiers', ...keys]);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A fixed, protected fixture: plans cannot supply paths, native input, scripts,
// permission outcomes or arbitrary storage. Only disposable installed bytes are granted.
export async function prepareExpiredDirectory(context, origin, installed, report, expect) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const settings = `${origin}/options.html#/settings?section=updates`;
  await page.goto(settings);
  await page.getByRole('button', { name: '安装目录与更新恢复', exact: true }).click();
  await page.getByRole('button', { name: '选择安装目录', exact: true }).click();
  let title = '';
  for (let attempt = 0; attempt < 100; attempt++) {
    title = execFileSync('xdotool', ['getactivewindow', 'getwindowname'], {
      encoding: 'utf8',
    }).trim();
    if (pickerTitle.test(title)) break;
    await pause(100);
  }
  assert.match(title, pickerTitle, 'A real native directory picker is required');
  const active = execFileSync('xdotool', ['getactivewindow'], { encoding: 'utf8' }).trim();
  execFileSync('xdotool', ['windowactivate', '--sync', active]);
  await pause(1500);
  key('ctrl+l');
  await pause(500);
  execFileSync('xdotool', ['type', '--clearmodifiers', installed]);
  const geometry = Object.fromEntries(
    execFileSync('xdotool', ['getwindowgeometry', '--shell', active], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  );
  const x = Number(geometry.X) + Number(geometry.WIDTH) - 50;
  const y = Number(geometry.Y) + Number(geometry.HEIGHT) - 27;
  assert.ok(Number.isFinite(x) && Number.isFinite(y));
  execFileSync('xdotool', ['mousemove', String(x), String(y), 'click', '1']);
  await pause(1500);
  execFileSync('import', ['-window', 'root', `${report}-native-grant.png`]);
  // The fixture's native edit dialog initially focuses Don't Allow.
  // Allow this visit only; never persist a grant or replace a permissions API.
  key('Tab');
  key('Return');
  const region = page.getByRole('region', { name: '目录更新', exact: true });
  await expect(region).toContainText(`安装目录：${path.basename(installed)}`);
  const granted = await inspectBinding(page);
  assert.equal(granted.permission, 'granted');
  assert.equal(granted.readable, true);
  const id = new URL(origin).host;
  assert.equal(granted.id, id);
  const manager = await context.newPage();
  await manager.goto('chrome://extensions');
  const developerMode = manager.locator('extensions-manager extensions-toolbar #devMode');
  await developerMode.waitFor();
  if ((await developerMode.getAttribute('aria-pressed')) !== 'true') await developerMode.click();
  const next = context.waitForEvent('serviceworker', {
    predicate: (worker) => new URL(worker.url()).host === id,
  });
  await manager.locator(`extensions-item[id="${id}"] #dev-reload-button`).click();
  await next;
  await manager.close();
  const reopened = await context.newPage();
  await reopened.goto(settings);
  const expired = await inspectBinding(reopened);
  assert.equal(expired.id, granted.id);
  assert.equal(expired.name, granted.name);
  assert.notEqual(expired.permission, 'granted', 'Reload must actually revoke the native grant');
  assert.equal(expired.readable, false);
  assert.equal(expired.error, 'NotAllowedError');
  await reopened.close();
  return { granted, expired, mechanism: 'native-picker-and-extension-reload' };
}

// Observation only: the product itself creates the binding through its visible control.
// No write transaction, permission request, API replacement or synthetic handle.
async function inspectBinding(page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((db) => db.name === 'lody-directory-binding'))
      throw new Error('Product binding database missing');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('lody-directory-binding');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const binding = await new Promise((resolve, reject) => {
        const request = db
          .transaction('binding', 'readonly')
          .objectStore('binding')
          .get('installation');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!(binding?.directory instanceof FileSystemDirectoryHandle))
        throw new Error('Real saved directory handle required');
      const permission = await binding.directory.queryPermission({ mode: 'readwrite' });
      let error = null;
      try {
        await binding.directory.getFileHandle('manifest.json');
      } catch (cause) {
        error = cause.name;
      }
      return {
        id: binding.id,
        name: binding.directory.name,
        permission,
        readable: error === null,
        error,
      };
    } finally {
      db.close();
    }
  });
}
