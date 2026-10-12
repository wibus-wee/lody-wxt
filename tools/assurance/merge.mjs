import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { modelHash, sourceFingerprint } from './catalog.mjs';
import { shardCases, validateShardReport } from './shard.mjs';

const reportDirectory = /^reports\/assurance\/[a-f0-9-]+$/;

// Independent workers never certify the whole model. Join only complete, matching lanes.
export function mergeManifests(inputs, expected) {
  const count = expected.webShards ?? 1;
  assert.equal(inputs.length, count + 1, 'Every web shard and extension lane are required');
  const lanes = new Set();
  for (const input of inputs) {
    assert.ok(['web', 'extension'].includes(input.lane), 'Unknown lane');
    const key = input.lane === 'web' ? `web-${input.shard?.index ?? 0}` : 'extension';
    assert.ok(!lanes.has(key), 'Duplicate lane');
    lanes.add(key);
    if (input.lane === 'web' && count > 1) {
      assert.equal(input.shard?.count, count, 'Wrong shard count');
      assert.deepEqual(
        input.selected,
        shardCases(input.authored, input.shard.index, count),
        'Wrong shard selection',
      );
    }
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
    shard: undefined,
    selected: undefined,
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
  const count = Number(process.env.ASSURANCE_WEB_SHARDS ?? 1);
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 16, 'Invalid shard count');
  const names = count === 1 ? ['web'] : Array.from({ length: count }, (_, i) => `web-${i}`);
  for (const name of [...names, 'extension']) {
    const lane = name === 'extension' ? 'extension' : 'web';
    const base = path.join(root, `assurance-${name}`);
    const latest = JSON.parse(
      await readFile(path.join(base, 'reports/assurance/latest.json'), 'utf8'),
    );
    assert.match(latest.directory, reportDirectory);
    const directory = path.join(base, latest.directory);
    const manifest = JSON.parse(await readFile(path.join(directory, 'run.json'), 'utf8'));
    assert.equal(manifest.lane, lane);
    assert.equal(latest.directory, `reports/assurance/${manifest.id}`);
    if (lane === 'web' && count > 1)
      assert.equal(name, `web-${manifest.shard?.index}`, 'Shard artifact mismatch');
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
    webShards: count,
    sourceHash: await sourceFingerprint(),
  });
  const destination = `reports/assurance/${manifest.id}`;
  await mkdir(destination, { recursive: true });
  const seen = new Set(['run.json']);
  const cucumber = [];
  for (const [index, directory] of directories.entries()) {
    for (const name of await readdir(directory)) {
      if (name === 'run.json') continue;
      if (name === 'cucumber-1.json' && count > 1) {
        assert.equal(inputs[index].lane, 'web', 'Unexpected web framework report');
        const report = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
        validateShardReport(report, inputs[index].selected);
        cucumber.push(...report);
        continue;
      }
      assert.ok(!seen.has(name), `Duplicate report ${name}`);
      seen.add(name);
      const source = path.join(directory, name);
      assert.ok((await lstat(source)).isFile(), 'Only regular evidence files may be joined');
      await copyFile(source, path.join(destination, name));
    }
  }
  if (count > 1) {
    validateShardReport(cucumber, manifest.authored);
    await writeFile(`${destination}/cucumber-1.json`, JSON.stringify(cucumber));
    seen.add('cucumber-1.json');
  }
  assert.ok(
    seen.has('cucumber-1.json') && seen.has('extension.json'),
    'Missing raw framework report',
  );
  await writeFile(`${destination}/run.json`, JSON.stringify(manifest, null, 2));
  await writeFile('reports/assurance/latest.json', JSON.stringify({ directory: destination }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  mergeReports(process.argv[2] ?? '.ci-inputs').catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
