import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { auditCatalog, modelHash, sourceFingerprint } from './catalog.mjs';
import { extensionRuns } from './extension-runs.mjs';
import { performanceBlocks } from './performance.mjs';
import { previewArgs, waitForPreview } from './preview.mjs';
import { generateReport } from './report.mjs';
import { shardCases } from './shard.mjs';

async function main() {
  const authored = await auditCatalog();
  const repeat = Number(process.env.ASSURANCE_REPEAT ?? 1);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20)
    throw new Error('ASSURANCE_REPEAT must be 1..20');
  const lane = process.env.ASSURANCE_LANE ?? 'all';
  if (!['all', 'web', 'extension'].includes(lane)) throw new Error('Invalid assurance lane');
  const web = lane !== 'extension';
  const extension = lane === 'extension' || process.argv.includes('--extension');
  const shard =
    lane === 'web'
      ? {
          index: Number(process.env.ASSURANCE_WEB_SHARD ?? 0),
          count: Number(process.env.ASSURANCE_WEB_SHARDS ?? 1),
        }
      : undefined;
  const selected = shard
    ? shardCases(
        authored.map((item) => item.key),
        shard.index,
        shard.count,
      )
    : undefined;
  const identity = process.env.ASSURANCE_RUN_ID;
  const id = identity ? createHash('sha256').update(identity).digest('hex') : randomUUID();
  const directory = `reports/assurance/${id}`;
  await mkdir(directory, { recursive: true });
  const manifest = {
    id,
    lane,
    shard,
    selected,
    candidateSha: process.env.CANDIDATE_SHA ?? null,
    modelHash,
    sourceHash: await sourceFingerprint(),
    startedAt: new Date().toISOString(),
    repeat,
    benchmarkAfterFirst: process.env.ASSURANCE_BENCHMARK_AFTER_FIRST === '1',
    failFast: process.env.ASSURANCE_FAIL_FAST === '1',
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
    const preparation = extension
      ? await run('pnpm', ['build'])
      : (await run('pnpm', ['build:sdk'])) || (await run('pnpm', ['build:ui']));
    manifest.layers.preparation = { exitCode: preparation };
    manifest.sourceHash = await sourceFingerprint();
    await writeFile(`${directory}/run.json`, JSON.stringify(manifest, null, 2));
    if (preparation !== 0) throw new Error('Product preparation failed before journey execution');
    if (web) {
      let occupied = false;
      try {
        occupied = (await fetch('http://127.0.0.1:4173', { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        /* No preview. */
      }
      if (occupied) throw new Error('Port 4173 is occupied; stop dev:web before assurance runs.');
      // Serve immutable built assets. Concurrent first navigations against the dev
      // server stalled on cold dependency/module requests in the failure traces.
      // Building first also makes the journeys exercise the shipped web output.
      const previewEnv = {
        VITE_SESSION_SHARE_ORIGIN: 'https://share.example.test',
        VITE_SESSION_SHARE_API_ORIGIN: 'https://share-api.example.test',
      };
      const webBuild = await run(
        'pnpm',
        ['exec', 'vite', 'build', '--config', 'vite.config.ts'],
        previewEnv,
      );
      manifest.layers.webBuild = { exitCode: webBuild };
      if (webBuild !== 0) throw new Error('Web build failed before journey execution');
      server = spawn(process.execPath, previewArgs, {
        stdio: 'inherit',
        env: { ...process.env, ...previewEnv },
      });
      await waitForPreview(server, 'http://127.0.0.1:4173');
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
        let tags =
          manifest.benchmarkAfterFirst && repetition > 1
            ? process.env.ASSURANCE_TAGS
              ? `(${process.env.ASSURANCE_TAGS}) and @performance`
              : '@performance'
            : process.env.ASSURANCE_TAGS;
        if (shard && shard.count > 1) {
          const selection = selected
            .map((key) => {
              const [journey, variant] = key.split('/');
              return `(@journey:${journey} and @case:${variant})`;
            })
            .join(' or ');
          tags = tags ? `(${tags}) and (${selection})` : selection;
        }
        if (manifest.failFast) args.push('--fail-fast');
        if (tags) args.push('--tags', tags);
        const code = await run(process.execPath, args, {
          ASSURANCE_REPETITION: String(repetition),
        });
        const report = JSON.parse(
          await readFile(`${directory}/cucumber-${repetition}.json`, 'utf8'),
        );
        if (!report.some((feature) => feature.elements?.some((item) => item.type === 'scenario')))
          throw new Error('No user journeys executed');
        result ||= code;
        if (code !== 0 && manifest.failFast) break;
      }
      manifest.layers.web = { exitCode: result };
    }
    if (extension) {
      let extensionResult = 0;
      for (const invocation of extensionRuns(repeat, directory, manifest.failFast)) {
        const code = await run('pnpm', invocation.args, invocation.env);
        extensionResult ||= code;
        if (code !== 0 && manifest.failFast) break;
      }
      manifest.layers.extension = { exitCode: extensionResult };
      result ||= extensionResult;
    }
  } finally {
    server?.kill('SIGTERM');
    manifest.finishedAt = new Date().toISOString();
    await writeFile(`${directory}/run.json`, JSON.stringify(manifest, null, 2));
    if (lane !== 'all') {
      process.exitCode = result;
    } else {
      const audit = await generateReport();
      if (
        audit.stale ||
        audit.layerFailures.length > 0 ||
        performanceBlocks(audit, process.env.ASSURANCE_PERFORMANCE_MODE) ||
        audit.cases.some((item) => ['failed', 'incomplete'].includes(item.status))
      )
        result = 1;
      process.exitCode = result;
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
