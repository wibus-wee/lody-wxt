import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
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
    '<!doctype html><html><head><title>Directory proof fixture</title></head><body><button id="pick">Select test directory</button><button id="write">Write test update</button><button id="reload">Reload</button><pre id="result"></pre><script src="proof.js"></script></body></html>',
  );
  await writeFile(
    path.join(extension, 'proof.js'),
    `
const output = document.querySelector('#result');
(async () => { output.textContent = JSON.stringify({version:chrome.runtime.getManifest().version,id:chrome.runtime.id,storage:await chrome.storage.local.get()}); })();
let directory;
document.querySelector('#pick').onclick = async () => { try {
 directory = await showDirectoryPicker({mode:'read'});
 output.textContent = 'READ_OK';
} catch(error) { output.textContent = String(error); } };
document.querySelector('#write').onclick = async () => { try {
 const permission = await directory.requestPermission({mode:'readwrite'});
 if (permission !== 'granted') throw new Error('Write permission: '+permission);
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
    await writeFile(
      path.join(report, 'browser.json'),
      JSON.stringify({ version: context.browser()?.version() }),
    );
    // Owner approved developer mode for this disposable CI profile on 2026-10-13.
    const settings = await context.newPage();
    await settings.goto('chrome://extensions');
    const developerMode = settings.locator('extensions-manager extensions-toolbar #devMode');
    await developerMode.waitFor();
    if ((await developerMode.getAttribute('aria-pressed')) !== 'true') await developerMode.click();
    assert.equal(await developerMode.getAttribute('aria-pressed'), 'true');
    await settings.screenshot({ path: path.join(report, '00-developer-mode.png') });
    await settings.close();
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
    // The GTK chooser's visible Open button, observed in the retained 1280x1024 CI screenshots.
    execFileSync('xdotool', ['mousemove', '1157', '830', 'click', '1']);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    screenshot('02-selected');
    await writeFile(path.join(report, 'page-state.txt'), await page.locator('body').textContent());
    // Explicitly accept the fixture-only read grant in the observed native dialog.
    execFileSync('xdotool', ['mousemove', '792', '224', 'click', '1']);
    await page.getByText('READ_OK', { exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Write test update', exact: true }).click();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    screenshot('03-permission');
    // Chromium initially focuses Cancel; move to the affirmative button for this synthetic write grant.
    key('Tab');
    key('Return');
    // Capture the real permission result without overriding browser grants.
    await writeFile(path.join(report, 'write-state.txt'), await page.locator('body').textContent());
    await page.getByText('WRITE_OK', { exact: true }).waitFor({ timeout: 10000 });
    screenshot('04-written');
    assert.equal(
      JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8')).version,
      '0.0.2',
    );
    const reloadedWorker = context.waitForEvent('serviceworker', {
      predicate: (next) => new URL(next.url()).host === id,
      timeout: 15000,
    });
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await reloadedWorker;
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
    // Read the browser's actual extension state; never re-enable it to make the proof pass.
    const diagnostic = await context.newPage();
    await diagnostic.goto('chrome://extensions');
    await writeFile(
      path.join(report, 'extension-state.json'),
      JSON.stringify(
        await diagnostic.evaluate(async () => await globalThis.chrome.management.getAll()),
        null,
        2,
      ),
    );
    await diagnostic.screenshot({ path: path.join(report, 'extensions-page.png') });
    await diagnostic.close();
    const session = await context.browser().newBrowserCDPSession();
    await writeFile(
      path.join(report, 'extension-histograms.json'),
      JSON.stringify(
        await session.send('Browser.getHistograms', { query: 'FileSystemAccess' }),
        null,
        2,
      ),
    );
    // Independent ordinary-origin control: only reads the disposable fixture directory.
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<button id="pick">Select control directory</button><pre id="result"></pre><script>
      document.querySelector('#pick').onclick = async () => {try {
        const handle = await showDirectoryPicker();
        const file = await handle.getFileHandle('manifest.json');
        document.querySelector('#result').textContent = 'CONTROL_READ_OK '+await (await file.getFile()).text();
      } catch(error) {document.querySelector('#result').textContent=String(error);}};
      </script>`);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const control = await context.newPage();
      await control.goto(`http://127.0.0.1:${server.address().port}`);
      await control.getByRole('button', { name: 'Select control directory', exact: true }).click();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      screenshot('control-picker');
      const title = execFileSync('xdotool', ['getactivewindow', 'getwindowname'], {
        encoding: 'utf8',
      }).trim();
      assert.match(title, pickerTitle);
      key('ctrl+l');
      await new Promise((resolve) => setTimeout(resolve, 500));
      execFileSync('xdotool', ['type', '--clearmodifiers', extension]);
      screenshot('control-path');
      execFileSync('xdotool', ['mousemove', '1157', '830', 'click', '1']);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      screenshot('control-permission');
      execFileSync('xdotool', ['mousemove', '792', '224', 'click', '1']);
      await control.getByText('CONTROL_READ_OK', { exact: false }).waitFor({ timeout: 10000 });
      screenshot('control-result');
      await writeFile(
        path.join(report, 'control-state.txt'),
        await control.locator('body').textContent(),
      );
      await writeFile(
        path.join(report, 'control-histograms.json'),
        JSON.stringify(
          await session.send('Browser.getHistograms', { query: 'FileSystemAccess' }),
          null,
          2,
        ),
      );
    } finally {
      server.close();
      await context.close();
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
