import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

const pickerTitle = /^(?:Select|Open|Choose)/;

async function main() {
  // A disposable, synthetic extension. No product account or user directory is used.
  const root = await mkdtemp(path.join(tmpdir(), 'lody-directory-proof-'));
  const extension = path.join(root, 'extension');
  const report = path.resolve('reports/directory-proof');
  await mkdir(extension);
  await mkdir(report, { recursive: true });
  const manifest = {
    manifest_version: 3,
    name: 'Directory proof fixture',
    version: '0.0.1',
    permissions: ['storage'],
    background: { service_worker: 'background.js' },
  };
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(
    path.join(extension, 'background.js'),
    'chrome.runtime.onInstalled.addListener(() => {});',
  );
  await writeFile(
    path.join(extension, 'proof.html'),
    '<!doctype html><html><head><title>Directory proof fixture</title></head><body><button id="pick">Select test directory</button><button id="reload">Reload</button><pre id="result"></pre><script src="proof.js"></script></body></html>',
  );
  await writeFile(
    path.join(extension, 'proof.js'),
    `
const output = document.querySelector('#result');
(async () => { output.textContent = JSON.stringify({version:chrome.runtime.getManifest().version,id:chrome.runtime.id,storage:await chrome.storage.local.get()}); })();
document.querySelector('#pick').onclick = async () => { try {
 const directory = await showDirectoryPicker({mode:'readwrite'});
 const file = await directory.getFileHandle('manifest.json');
 const manifest = JSON.parse(await (await file.getFile()).text());
 if (manifest.name !== 'Directory proof fixture') throw new Error('Unexpected directory');
 await chrome.storage.local.set({proof:'retained'});
 manifest.version = '0.0.2';
 const writer = await file.createWritable(); await writer.write(JSON.stringify(manifest)); await writer.close();
 output.textContent = 'WRITE_OK';
} catch (error) { output.textContent = String(error); } };
document.querySelector('#reload').onclick = () => chrome.runtime.reload();
`,
  );
  const context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
    channel: 'chromium',
    headless: false,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const screenshot = (name) =>
    execFileSync('import', ['-window', 'root', path.join(report, `${name}.png`)]);
  const key = (...keys) => execFileSync('xdotool', ['key', '--clearmodifiers', ...keys]);
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    const url = `chrome-extension://${id}/proof.html`;
    await page.goto(url);
    await page.getByRole('button', { name: 'Select test directory', exact: true }).click();
    // Read the native chooser title before sending a path to it.
    let title = '';
    for (let i = 0; i < 100; i++) {
      title = execFileSync('xdotool', ['getactivewindow', 'getwindowname'], {
        encoding: 'utf8',
      }).trim();
      if (pickerTitle.test(title)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    screenshot('01-picker');
    assert.match(title, pickerTitle, 'Native directory picker did not open');
    const pickerWindow = execFileSync('xdotool', ['getactivewindow'], { encoding: 'utf8' }).trim();
    execFileSync('xdotool', ['windowactivate', '--sync', pickerWindow]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    key('ctrl+l');
    await new Promise((resolve) => setTimeout(resolve, 500));
    screenshot('01-location');
    execFileSync('xdotool', ['type', '--clearmodifiers', extension]);
    screenshot('01-path');
    key('Return');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    screenshot('02-selected');
    key('Return');
    await new Promise((resolve) => setTimeout(resolve, 500));
    screenshot('03-permission');
    // Preserve the permission dialog for inspection; never blindly confirm another chooser.
    await writeFile(path.join(report, 'page-state.txt'), await page.locator('body').textContent());
    await page.getByText('WRITE_OK', { exact: true }).waitFor({ timeout: 10000 });
    screenshot('04-written');
    assert.equal(
      JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8')).version,
      '0.0.2',
    );
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    const after = await context.newPage();
    await after.goto(url);
    await after.getByText('"version":"0.0.2"', { exact: false }).waitFor();
    const state = JSON.parse(await after.locator('#result').textContent());
    assert.equal(state.id, id);
    assert.equal(state.storage.proof, 'retained');
    screenshot('05-reloaded');
    await writeFile(
      path.join(report, 'result.json'),
      JSON.stringify(
        { version: state.version, id, storageRetained: true, realDirectoryWrite: true },
        null,
        2,
      ),
    );
  } finally {
    screenshot('final');
    await context.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
