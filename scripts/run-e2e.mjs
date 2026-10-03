import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import process from 'node:process';

await mkdir('reports', { recursive: true });
const port = process.env.LODY_E2E_PORT ?? '4273';
const baseUrl = `http://127.0.0.1:${port}`;
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
  throw new Error('LODY_E2E_PORT must be a port between 1024 and 65535.');
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', () =>
    reject(new Error(`Port ${port} is in use. Stop the server before running E2E.`)),
  );
  probe.listen(Number(port), '127.0.0.1', () => probe.close(resolve));
});
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--config', 'vite.config.ts', '--port', port],
  { stdio: 'inherit', env: { ...process.env, LODY_E2E_PORT: port } },
);
let result = 1;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('E2E server exited before becoming ready.');
    try {
      ready = (await fetch(baseUrl)).ok;
    } catch {
      /* Server is starting. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error(`E2E server did not become ready on port ${port}.`);
  const cucumber = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'node_modules/@cucumber/cucumber/bin/cucumber.js',
      '--config',
      'cucumber.mjs',
    ],
    { stdio: 'inherit', env: { ...process.env, LODY_E2E_URL: baseUrl } },
  );
  result = await new Promise((resolve) => cucumber.on('exit', (code) => resolve(code ?? 1)));
  const report = JSON.parse(await readFile('reports/cucumber.json', 'utf8'));
  if (!report.some((feature) => feature.elements?.some((element) => element.type === 'scenario')))
    throw new Error('Cucumber executed no scenarios. Check paths and profile configuration.');
} finally {
  server.kill('SIGTERM');
  const generator = spawn(process.execPath, ['scripts/generate-coverage.mjs'], {
    stdio: 'inherit',
  });
  const code = await new Promise((resolve) => generator.on('exit', (code) => resolve(code ?? 1)));
  if (code !== 0) result = code;
}
process.exitCode = result;
