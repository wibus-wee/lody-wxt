import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  validateInlineScreenshotEvidence,
  validateScreenshotManifest,
} from './screenshot-manifest.mjs';

export const target = 'src/features/account/controller.ts';
const journey = 'change-identity-during-work';
const variant = 'token-expiry';
const anchor = '    this.expiryTimer = setTimeout(\n';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const revisionPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const expiryAssertionPattern = /(?:toHaveCount|toContainText|toBeNull)/;
const digest = (text) => createHash('sha256').update(text).digest('hex');

// Expectations and the byte reader belong to trusted orchestration, never the artifact.
export async function verifyProbeUiEvidence(manifest, body, expected, readPublishedScreenshot) {
  const strict = expected && ('headSha' in expected || 'baseSha' in expected);
  assert.match(
    expected?.beforeSha ?? expected?.baseSha ?? '',
    revisionPattern,
    'Trusted before SHA required',
  );
  assert.match(
    expected?.candidateSha ?? expected?.headSha ?? '',
    revisionPattern,
    'Trusted candidate SHA required',
  );
  assert.match(expected?.fixtureHash ?? '', hashPattern, 'Trusted fixture hash required');
  assert.equal(manifest?.fixtureHash, expected.fixtureHash, 'Screenshot fixtures mismatch');
  if (strict) {
    validateScreenshotManifest(manifest, { ...expected, body });
  } else {
    assert.equal(
      typeof readPublishedScreenshot,
      'function',
      'Trusted published-byte reader required',
    );
    validateInlineScreenshotEvidence(manifest, body, expected);
  }
  const captures = [];
  for (const capture of manifest.captures) {
    const bytes =
      strict && !readPublishedScreenshot
        ? expected.readArtifact(capture.path)
        : await readPublishedScreenshot(capture.url);
    assert.ok(
      Buffer.isBuffer(bytes) || bytes instanceof Uint8Array,
      'Published screenshot bytes required',
    );
    assert.ok(bytes.length > 0, 'Empty published screenshot');
    assert.equal(digest(bytes), capture.contentHash, 'Published screenshot hash mismatch');
    captures.push({
      role: capture.role,
      sha: capture.sha,
      url: capture.url,
      contentHash: capture.contentHash,
    });
  }
  return {
    schemaVersion: 1,
    status: 'passed',
    publicationVerification: strict ? 'trusted-upload-receipts' : 'published-byte-reader',
    fixtureHash: manifest.fixtureHash,
    manifestHash: digest(JSON.stringify(manifest)),
    captures,
  };
}

export function mutate(source) {
  assert.equal(source.split(anchor).length, 2, 'Expiry mutation anchor must occur exactly once');
  return source.replace(
    anchor,
    `    return; // autonomy controlled regression: expiry never revokes authorization\n${anchor}`,
  );
}

export function assess(report, evidence, expected, mutant = false) {
  const scenarios = report
    .flatMap((feature) => feature.elements ?? [])
    .filter((item) => item.type === 'scenario');
  assert.equal(scenarios.length, 1, 'Exactly one scenario must execute');
  const scenario = scenarios[0];
  assert.equal(scenario.name, `${journey} / ${variant}`);
  const steps = scenario.steps.filter(
    (step) => step.keyword.trim() !== 'Before' && step.keyword.trim() !== 'After',
  );
  assert.ok(steps.length >= 5, 'Missing behavioral steps');
  assert.equal(evidence.journey, journey);
  assert.equal(evidence.case, variant);
  assert.equal(evidence.runId, expected.id);
  assert.equal(evidence.sourceHash, expected.sourceHash);
  assert.equal(evidence.modelHash, expected.modelHash);
  assert.equal(evidence.layer, 'web');
  const checkpoints = evidence.checkpoints.map((item) => item.id);
  if (mutant) {
    assert.equal(evidence.status, 'failed');
    const failed = steps.filter((step) => step.result?.status === 'failed');
    assert.equal(failed.length, 1);
    assert.equal(failed[0].name, 'the product obligations for this segment hold');
    const preceding = steps.slice(0, steps.indexOf(failed[0]));
    assert.ok(preceding.every((step) => step.result?.status === 'passed'));
    assert.ok(
      preceding.some(
        (step) => step.name === 'my authorization expires while a conversation is streaming',
      ),
    );
    assert.match(failed[0].result.error_message ?? '', expiryAssertionPattern);
    assert.deepEqual(checkpoints, [], 'Mutation must fail at first expiry obligation');
  } else {
    assert.equal(evidence.status, 'passed');
    assert.ok(steps.every((step) => step.result?.status === 'passed'));
    assert.deepEqual([...checkpoints].sort(), [...expected.obligations].sort());
  }
}

async function execute(cwd, command, args, env, log, timeout = 180_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk) => {
      output += chunk;
      if (output.length > 4_000_000) output = output.slice(-4_000_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }, timeout);
    child.on('error', reject);
    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      try {
        await writeFile(log, output);
        resolve({ code, signal, command, args });
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function snapshot(destination) {
  const files = execFileSync('git', ['ls-files', '-z', '--recurse-submodules'], { cwd: root })
    .toString()
    .split('\0')
    .filter(Boolean);
  for (const file of files) {
    const source = path.join(root, file);
    const stat = await lstat(source);
    const resolved = await realpath(source);
    assert.ok(resolved.startsWith(`${root}${path.sep}`), `Snapshot link escapes checkout: ${file}`);
    assert.ok(
      stat.isFile() || (stat.isSymbolicLink() && (await lstat(resolved)).isFile()),
      `Snapshot requires regular files: ${file}`,
    );
    const output = path.join(destination, file);
    await mkdir(path.dirname(output), { recursive: true });
    await copyFile(source, output);
  }
  // Relink workspace packages into the copy; pnpm's original links would test the original SDK.
  const modules = path.join(destination, 'node_modules');
  await mkdir(modules);
  for (const entry of await readdir(path.join(root, 'node_modules'))) {
    if (entry.startsWith('@')) {
      await mkdir(path.join(modules, entry));
      for (const name of await readdir(path.join(root, 'node_modules', entry))) {
        const workspacePackage =
          `${entry}/${name}` === '@lody-mobile/sdk'
            ? path.join(destination, 'packages/lody-sdk')
            : `${entry}/${name}` === '@lody/ui'
              ? path.join(destination, 'vendor/lody/packages/ui')
              : null;
        await symlink(
          workspacePackage ?? (await realpath(path.join(root, 'node_modules', entry, name))),
          path.join(modules, entry, name),
          'dir',
        );
      }
    } else {
      await symlink(
        await realpath(path.join(root, 'node_modules', entry)),
        path.join(modules, entry),
        'dir',
      );
    }
  }
  for (const directory of ['packages/lody-sdk', 'vendor/lody/packages/ui']) {
    const dependencies = path.join(root, directory, 'node_modules');
    await lstat(dependencies);
    await symlink(dependencies, path.join(destination, directory, 'node_modules'), 'dir');
  }
}

export async function run({ candidate, extension = false, uiEvidence } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lody-autonomy-'));
  const workspace = path.join(directory, 'workspace');
  await mkdir(workspace);
  const result = { accepted: false, directory, phases: [], startedAt: new Date().toISOString() };
  console.error(`Probe evidence: ${directory}`);
  try {
    if (uiEvidence) {
      result.uiEvidence = await verifyProbeUiEvidence(
        uiEvidence.manifest,
        uiEvidence.body,
        uiEvidence.expected,
        uiEvidence.readPublishedScreenshot,
      );
    }
    const original = await readFile(path.join(root, target), 'utf8');
    const candidateSource = candidate ? await readFile(path.resolve(candidate), 'utf8') : original;
    const mutant = mutate(original);
    result.source = {
      baseline: digest(original),
      mutant: digest(mutant),
      candidate: digest(candidateSource),
    };
    await snapshot(workspace);
    const { modelHash, findCase } = await import('../assurance/catalog.mjs');
    const obligations = findCase(journey, variant).variant.obligations;
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: tmpdir(),
      CI: '1',
      VITE_SESSION_SHARE_ORIGIN: 'https://share.example.test',
      VITE_SESSION_SHARE_API_ORIGIN: 'https://share-api.example.test',
    };
    for (const [name, source] of [
      ['baseline', original],
      ['mutant', mutant],
      ['candidate', candidateSource],
    ]) {
      const phase = path.join(directory, name);
      await mkdir(phase);
      await writeFile(path.join(workspace, target), source);
      const manifest = { id: randomUUID(), modelHash, sourceHash: digest(source), obligations };
      await writeFile(path.join(phase, 'run.json'), JSON.stringify(manifest));
      const phaseEnv = { ...env, ASSURANCE_RUN_DIRECTORY: phase, ASSURANCE_REPETITION: '1' };
      for (const script of ['build:sdk', 'build:ui']) {
        const prep = await execute(
          workspace,
          'pnpm',
          [script],
          phaseEnv,
          path.join(phase, `${script.replace(':', '-')}.log`),
        );
        assert.equal(prep.code, 0, `${name}: ${script} failed`);
      }
      let occupied = false;
      try {
        await fetch('http://127.0.0.1:4173', { signal: AbortSignal.timeout(500) });
        occupied = true;
      } catch {}
      assert.ok(!occupied, 'Port 4173 occupied; refusing to test another application');
      const server = spawn(
        process.execPath,
        ['node_modules/vite/bin/vite.js', '--config', 'vite.config.ts'],
        { cwd: workspace, env: phaseEnv, detached: true, stdio: 'ignore' },
      );
      let startupError;
      server.on('error', (error) => {
        startupError = error;
      });
      try {
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          assert.ok(!startupError && server.exitCode === null, 'Preview failed');
          try {
            ready = (await fetch('http://127.0.0.1:4173', { signal: AbortSignal.timeout(500) })).ok;
          } catch {}
          if (ready) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(ready, 'Preview startup timeout');
        const execution = await execute(
          workspace,
          process.execPath,
          [
            '--import',
            'tsx',
            'node_modules/@cucumber/cucumber/bin/cucumber.js',
            '--config',
            'cucumber.mjs',
            '--tags',
            `@journey:${journey} and @case:${variant}`,
            '--format',
            `json:${phase}/cucumber.json`,
          ],
          phaseEnv,
          path.join(phase, 'browser.log'),
        );
        assert.equal(execution.signal, null, 'Browser process interrupted');
        assert.equal(execution.code, name === 'mutant' ? 1 : 0, 'Unexpected browser exit');
        const report = JSON.parse(await readFile(path.join(phase, 'cucumber.json'), 'utf8'));
        const evidence = JSON.parse(
          await readFile(path.join(phase, `${journey}-${variant}-web-1.evidence.json`), 'utf8'),
        );
        assess(report, evidence, manifest, name === 'mutant');
        const trace = await lstat(evidence.trace);
        assert.ok(trace.isFile() && trace.size > 0, 'Missing browser trace');
        result.phases.push({ name, ...execution, manifest });
      } finally {
        try {
          process.kill(-server.pid, 'SIGKILL');
        } catch {}
        if (server.exitCode === null) await new Promise((resolve) => server.once('close', resolve));
      }
    }
    if (extension) {
      const build = await execute(
        workspace,
        'pnpm',
        ['exec', 'wxt', 'build'],
        env,
        path.join(directory, 'extension-build.log'),
      );
      assert.equal(build.code, 0, 'Extension build failed');
      const check = await execute(
        workspace,
        'pnpm',
        ['exec', 'playwright', 'test', 'tests/extension/persistence.spec.ts'],
        env,
        path.join(directory, 'extension.log'),
      );
      assert.equal(check.code, 0, 'Extension verification failed');
      const report = JSON.parse(
        await readFile(path.join(workspace, 'reports/extension.json'), 'utf8'),
      );
      assert.equal(report.stats.expected, 1);
      assert.equal(report.stats.unexpected, 0);
      assert.equal(report.stats.skipped, 0);
      assert.equal(report.stats.flaky, 0);
      result.extension = check;
    }
    result.accepted = true;
  } catch (error) {
    result.error = error.message;
  }
  result.finishedAt = new Date().toISOString();
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(
    args.every(
      (arg, index) =>
        arg === '--extension' || arg === '--candidate' || args[index - 1] === '--candidate',
    ),
    'Unknown argument',
  );
  const index = args.indexOf('--candidate');
  assert.ok(
    index < 0 || (args[index + 1] && !args[index + 1].startsWith('--')),
    'Missing candidate file',
  );
  const result = await run({
    candidate: index < 0 ? undefined : args[index + 1],
    extension: args.includes('--extension'),
  });
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = result.accepted ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
