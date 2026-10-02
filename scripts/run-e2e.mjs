import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import process from 'node:process';

await mkdir('reports', { recursive: true });
let existingServer = false;
try {
  existingServer = (await fetch('http://127.0.0.1:4173', { signal: AbortSignal.timeout(1000) })).ok;
} catch {
  /* No server is listening. */
}
if (existingServer) throw new Error('Port 4173 is in use. Stop dev:web before running E2E.');
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--config', 'vite.config.ts'],
  { stdio: 'inherit' },
);
let result = 1;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('E2E server exited before becoming ready.');
    try {
      ready = (await fetch('http://127.0.0.1:4173')).ok;
    } catch {
      /* Server is starting. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('E2E server did not become ready on port 4173.');
  const cucumber = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'node_modules/@cucumber/cucumber/bin/cucumber.js',
      '--config',
      'cucumber.mjs',
    ],
    { stdio: 'inherit' },
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
