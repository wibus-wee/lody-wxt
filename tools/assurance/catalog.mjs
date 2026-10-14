import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import { model } from './model.mjs';

const tagSeparator = /\s+/;

export const modelHash = createHash('sha256').update(JSON.stringify(model)).digest('hex');
export const caseKey = (journey, variant) => `${journey}/${variant}`;

export function findCase(journeyId, caseId) {
  const journey = model.journeys.find((item) => item.id === journeyId);
  const variant = journey?.cases.find((item) => item.id === caseId);
  assert.ok(journey && variant, `Unknown product case ${journeyId}/${caseId}`);
  return { journey, variant };
}

export function validateModel() {
  const ids = new Set();
  for (const journey of model.journeys) {
    assert.ok(!ids.has(journey.id), `Duplicate journey ${journey.id}`);
    ids.add(journey.id);
    assert.equal(model.namespaces[journey.namespace]?.disposition, 'journey');
    assert.ok(journey.chain.length >= 3, `${journey.id} must cross several product links`);
    for (const owner of journey.chain) assert.ok(model.owners[owner], `Unknown owner ${owner}`);
    const cases = new Set();
    for (const variant of journey.cases) {
      assert.ok(!cases.has(variant.id), `Duplicate case ${journey.id}/${variant.id}`);
      cases.add(variant.id);
      if (variant.requiredLayer) assert.equal(variant.requiredLayer, 'extension');
      assert.ok(variant.lifecycle.length >= 3 && variant.obligations.length >= 3);
      assert.equal(new Set(variant.obligations).size, variant.obligations.length);
      for (const state of variant.states)
        assert.ok(journey.chain.includes(state.split(':')[0]), `Unowned state ${state}`);
    }
  }
  for (const entry of Object.values(model.namespaces))
    for (const owner of entry.owners) assert.ok(model.owners[owner]);
  for (const interaction of model.interactions) assert.ok(ids.has(interaction.journey));
  for (const journey of model.journeys)
    for (const variant of journey.cases)
      for (const id of variant.interactions ?? [])
        assert.ok(
          model.interactions.some((entry) => entry.id === id && entry.journey === journey.id),
        );
}

export async function sourceFingerprint() {
  const hash = createHash('sha256');
  async function visit(path) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
      const file = `${path}/${entry.name}`;
      if (file === 'tools/assurance/baseline.json') continue;
      if (entry.isDirectory()) await visit(file);
      else hash.update(file).update(await readFile(file));
    }
  }
  for (const directory of [
    'src',
    'packages/lody-sdk/src',
    'tests',
    'tools/assurance',
    'vendor/lody/packages/ui/src',
    'vendor/lody/packages/components/src',
    'vendor/lody/packages/shared/src',
    'vendor/runeicons/packages/runeicons',
  ])
    await visit(directory);
  for (const file of [
    'package.json',
    'pnpm-lock.yaml',
    'wxt.config.ts',
    'cucumber.mjs',
    'vite.config.ts',
    'playwright.config.ts',
    'tools/vite/plugins.ts',
    'tools/vite/wasm.ts',
    'tools/vite/worker-wasm.ts',
    'tools/ui/build.mjs',
    'tools/update-probe/product.mjs',
    'tools/release/update-index.mjs',
    'packages/lody-sdk/scripts/build.mjs',
  ])
    hash.update(file).update(await readFile(file));
  for (const directory of ['vendor/lody', 'vendor/runeicons']) {
    hash.update(directory).update(execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD']));
  }
  return hash.digest('hex');
}

// Only explicit Scenario declarations are accepted; examples never inflate the case denominator.
export async function authoredScenarios() {
  const cases = new Set();
  const scenarios = [];
  for (const name of (await readdir('tests/e2e/features')).toSorted()) {
    if (!name.endsWith('.feature')) continue;
    const file = `tests/e2e/features/${name}`;
    const lines = (await readFile(file, 'utf8')).split('\n');
    let tags = [];
    let scenario;
    function finish() {
      if (!scenario) return;
      assert.ok(
        scenario.actions >= 2 && scenario.assertions >= 2,
        `${file}: Journey needs multiple user actions and observed consequences`,
      );
      scenarios.push(scenario);
    }
    for (const [index, line] of lines.entries()) {
      const text = line.trim();
      if (text.startsWith('@')) tags.push(...text.split(tagSeparator));
      if (text.startsWith('Scenario Outline:'))
        throw new Error(`${file}: Use one authored lifecycle case, not example-count coverage`);
      if (text.startsWith('Scenario:')) {
        finish();
        const value = (prefix) => tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);
        const journeyId = value('@journey:');
        const variantId = value('@case:');
        const { journey, variant } = findCase(journeyId, variantId);
        assert.equal(value('@namespace:'), journey.namespace, `${file}: Namespace mismatch`);
        for (const state of variant.states)
          assert.ok(tags.includes(`@state:${state}`), `${file}: Missing state ${state}`);
        for (let i = 1; i < variant.lifecycle.length; i++)
          assert.ok(
            tags.includes(`@transition:${variant.lifecycle[i - 1]}>${variant.lifecycle[i]}`),
            `${file}: Missing lifecycle transition`,
          );
        const key = caseKey(journeyId, variantId);
        assert.ok(!cases.has(key), `Duplicate authored case ${key}`);
        cases.add(key);
        scenario = {
          key,
          name: text.slice(9).trim(),
          file,
          line: index + 1,
          actions: 0,
          assertions: 0,
        };
        tags = [];
      } else if (scenario && text.startsWith('When ')) scenario.actions++;
      else if (scenario && text.startsWith('Then ')) scenario.assertions++;
    }
    finish();
  }
  return scenarios;
}

export async function auditCatalog() {
  validateModel();
  for (const owner of Object.values(model.owners))
    for (const file of owner.source) await readFile(file);
  const namespaces = JSON.parse(await readFile('tests/e2e/namespaces.json', 'utf8'));
  assert.deepEqual(
    namespaces,
    model.namespaces,
    'Namespace registry must match product disposition, not test discovery',
  );
  return authoredScenarios();
}
