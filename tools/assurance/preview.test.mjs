import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { previewArgs, waitForPreview } from './preview.mjs';

const running = { exitCode: null, signalCode: null };
async function fixture(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('assurance serves built output rather than cold dev modules', async () => {
  assert.equal(previewArgs[1], 'preview');
  assert.ok(previewArgs.includes('--strictPort'));
  const source = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf("['exec', 'vite', 'build'") < source.indexOf('server = spawn('));
  assert.match(source, /if \(webBuild !== 0\) throw/);
  assert.match(source, /manifest\.layers\.preparation\.exitCode \|\|= webBuild/);
});
test('readiness accepts a completed HTTP response', async (t) => {
  const url = await fixture(t, (_, res) => res.end('ready'));
  await waitForPreview(running, url);
});
test('readiness retries startup errors but does not accept them', async (t) => {
  let requests = 0;
  const url = await fixture(t, (_, res) => {
    res.statusCode = ++requests === 1 ? 503 : 200;
    res.end('starting');
  });
  await waitForPreview(running, url, { intervalMs: 5 });
  assert.equal(requests, 2);
});
test('accepted connection with unfinished response is bounded', async (t) => {
  const url = await fixture(t, (_, res) => {
    res.writeHead(200);
    res.flushHeaders();
  });
  await assert.rejects(
    waitForPreview(running, url, { timeoutMs: 120, requestTimeoutMs: 30, intervalMs: 5 }),
    /readiness deadline/,
  );
});
test('early process exit and signal fail closed', async () => {
  for (const server of [{ exitCode: 1 }, { exitCode: null, signalCode: 'SIGTERM' }])
    await assert.rejects(waitForPreview(server, 'http://127.0.0.1:1'), /exited/);
});
