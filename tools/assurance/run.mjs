import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { auditCatalog, modelHash, sourceFingerprint } from './catalog.mjs';
import { generateReport } from './report.mjs';

async function main() {
  const authored = await auditCatalog();
  const repeat = Number(process.env.ASSURANCE_REPEAT ?? 1);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20)
    throw new Error('ASSURANCE_REPEAT must be 1..20');
  const id = randomUUID();
  const directory = `reports/assurance/${id}`;
  await mkdir(directory, { recursive: true });
  const manifest = {
    id,
    modelHash,
    sourceHash: await sourceFingerprint(),
    startedAt: new Date().toISOString(),
    repeat,
    benchmarkAfterFirst: process.env.ASSURANCE_BENCHMARK_AFTER_FIRST === '1',
    authored: authored.map((item) => item.key),
    layers: {},
  };
  await writeFile(`${directory}/run.json`, JSON.stringify(manifest, null, 2));
  await writeFile('reports/assurance/latest.json', JSON.stringify({ directory }));
  const run = (command, args, env = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: 'inherit',
        env: { ...process.env, ASSURANCE_RUN_DIRECTORY: directory, ...env },
      });
      child.on('error', reject);
      child.on('exit', (code) => resolve(code ?? 1));
    });
  let server;
  let result = 0;
  try {
    const preparation = process.argv.includes('--extension')
      ? await run('pnpm', ['build'])
      : (await run('pnpm', ['build:sdk'])) || (await run('pnpm', ['build:ui']));
    manifest.layers.preparation = { exitCode: preparation };
    manifest.sourceHash = await sourceFingerprint();
    await writeFile(`${directory}/run.json`, JSON.stringify(manifest, null, 2));
    if (preparation !== 0) throw new Error('Product preparation failed before journey execution');
    let occupied = false;
    try {
      occupied = (await fetch('http://127.0.0.1:4173', { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      /* No preview. */
    }
    if (occupied) throw new Error('Port 4173 is occupied; stop dev:web before assurance runs.');
    server = spawn(
      process.execPath,
      ['node_modules/vite/bin/vite.js', '--config', 'vite.config.ts'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          VITE_SESSION_SHARE_ORIGIN: 'https://share.example.test',
          VITE_SESSION_SHARE_API_ORIGIN: 'https://share-api.example.test',
        },
      },
    );
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error('Preview exited before becoming ready');
      try {
        ready = (await fetch('http://127.0.0.1:4173')).ok;
      } catch {
        /* Starting. */
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error('Preview failed to start');
    for (let repetition = 1; repetition <= repeat; repetition++) {
      const args = [
        '--import',
        'tsx',
        'node_modules/@cucumber/cucumber/bin/cucumber.js',
        '--config',
        'cucumber.mjs',
        '--format',
        `json:${directory}/cucumber-${repetition}.json`,
      ];
      const tags =
        manifest.benchmarkAfterFirst && repetition > 1
          ? process.env.ASSURANCE_TAGS
            ? `(${process.env.ASSURANCE_TAGS}) and @performance`
            : '@performance'
          : process.env.ASSURANCE_TAGS;
      if (tags) args.push('--tags', tags);
      const code = await run(process.execPath, args, { ASSURANCE_REPETITION: String(repetition) });
      const report = JSON.parse(await readFile(`${directory}/cucumber-${repetition}.json`, 'utf8'));
      if (!report.some((feature) => feature.elements?.some((item) => item.type === 'scenario')))
        throw new Error('No user journeys executed');
      result ||= code;
    }
    manifest.layers.web = { exitCode: result };
    if (process.argv.includes('--extension')) {
      const extension = await run('pnpm', ['exec', 'playwright', 'test']);
      manifest.layers.extension = { exitCode: extension };
      result ||= extension;
    }
  } finally {
    server?.kill('SIGTERM');
    manifest.finishedAt = new Date().toISOString();
    await writeFile(`${directory}/run.json`, JSON.stringify(manifest, null, 2));
    const audit = await generateReport();
    if (
      audit.stale ||
      audit.layerFailures.length > 0 ||
      audit.measurementFailures.length > 0 ||
      audit.cases.some((item) => ['failed', 'incomplete'].includes(item.status)) ||
      audit.performance.some((item) => item.comparison.status === 'regression')
    )
      result = 1;
    process.exitCode = result;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
