import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { modelHash, sourceFingerprint } from './catalog.mjs';

// Independent workers never certify the whole model. Join only complete, matching lanes.
export function mergeManifests(inputs, expected) {
  assert.equal(inputs.length, 2, 'Both web and extension lanes are required');
  const lanes = new Set();
  for (const input of inputs) {
    assert.ok(['web', 'extension'].includes(input.lane), 'Unknown lane');
    assert.ok(!lanes.has(input.lane), 'Duplicate lane');
    lanes.add(input.lane);
    for (const field of ['id', 'sourceHash', 'modelHash', 'candidateSha'])
      assert.equal(input[field], expected[field], `Mismatched ${field}`);
    assert.ok(input.finishedAt, 'Unfinished lane');
    assert.equal(input.repeat, 1, 'PR lanes execute each journey once');
    assert.deepEqual(Object.keys(input.layers).sort(), ['preparation', input.lane].sort());
    for (const result of Object.values(input.layers))
      assert.equal(result.exitCode, 0, 'Failed lane');
    assert.deepEqual(input.authored, inputs[0].authored, 'Different coverage catalog');
  }
  return {
    ...inputs[0],
    lane: 'all',
    startedAt: inputs.map((input) => input.startedAt).sort()[0],
    finishedAt: inputs
      .map((input) => input.finishedAt)
      .sort()
      .at(-1),
    layers: { preparation: { exitCode: 0 }, web: { exitCode: 0 }, extension: { exitCode: 0 } },
    laneReceipts: inputs,
  };
}

export async function mergeReports(root) {
  const inputs = [];
  const directories = [];
  for (const lane of ['web', 'extension']) {
    const base = path.join(root, `assurance-${lane}`);
    const latest = JSON.parse(
      await readFile(path.join(base, 'reports/assurance/latest.json'), 'utf8'),
    );
    assert.match(latest.directory, /^reports\/assurance\/[a-f0-9-]+$/);
    const directory = path.join(base, latest.directory);
    const manifest = JSON.parse(await readFile(path.join(directory, 'run.json'), 'utf8'));
    assert.equal(manifest.lane, lane);
    assert.equal(latest.directory, `reports/assurance/${manifest.id}`);
    inputs.push(manifest);
    directories.push(directory);
  }
  const identity = process.env.ASSURANCE_RUN_ID;
  assert.ok(identity, 'Run identity is required');
  const { createHash } = await import('node:crypto');
  const manifest = mergeManifests(inputs, {
    id: createHash('sha256').update(identity).digest('hex'),
    candidateSha: process.env.CANDIDATE_SHA,
    modelHash,
    sourceHash: await sourceFingerprint(),
  });
  const destination = `reports/assurance/${manifest.id}`;
  await mkdir(destination, { recursive: true });
  const seen = new Set(['run.json']);
  for (const directory of directories) {
    for (const name of await readdir(directory)) {
      if (name === 'run.json') continue;
      assert.ok(!seen.has(name), `Duplicate report ${name}`);
      seen.add(name);
      const source = path.join(directory, name);
      assert.ok((await lstat(source)).isFile(), 'Only regular evidence files may be joined');
      await copyFile(source, path.join(destination, name));
    }
  }
  assert.ok(
    seen.has('cucumber-1.json') && seen.has('extension.json'),
    'Missing raw framework report',
  );
  await writeFile(`${destination}/run.json`, JSON.stringify(manifest, null, 2));
  await writeFile('reports/assurance/latest.json', JSON.stringify({ directory: destination }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await mergeReports(process.argv[2] ?? '.ci-inputs');
