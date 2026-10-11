import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parsePolicy } from './common.mjs';
import { validateContract } from './contract.mjs';
import { assertNoCommittedScreenshots, classifyImpact } from './impact.mjs';
import { affectedImporters, loadImpactGraph, reverseDependencies } from './impact-graph.mjs';
import { validateImpactCapturePlans } from './orchestrate.mjs';

test('screenshot outputs cannot enter Git, including force-adds and renames into evidence directories', () => {
  const policy = { protectedPrefixes: [], elevatedPrefixes: [], nonRuntimePrefixes: [] };
  const model = { owners: {}, journeys: [] };
  for (const path of [
    'reports/autonomy/screenshots/candidate.png',
    'test-results/run/candidate.png',
    'playwright-report/data/candidate.png',
    'docs/screenshots/before.png',
    'tests/__screenshots__/after.png',
    'tests/__image_snapshots__/after.png',
    'tests/e2e/captures/candidate.png',
  ]) {
    assert.throws(() => classifyImpact([path], policy, model), /never Git/);
    assert.throws(
      () =>
        classifyImpact(
          [{ filename: path, previous_filename: 'docs/asset.png', status: 'renamed' }],
          policy,
          model,
        ),
      /never Git/,
    );
    assertNoCommittedScreenshots([{ filename: path, status: 'removed' }]);
  }
  assertNoCommittedScreenshots(['tests/e2e/captures/reader-scroll.json', 'docs/logo.png']);
});

test('Git ignores generated captures while capture instructions remain trackable', () => {
  const paths = [
    'reports/autonomy/screenshots/candidate.png',
    'tests/e2e/captures/candidate.png',
    'docs/screenshots/before.png',
    'tests/__screenshots__/after.png',
    'tests/__image_snapshots__/after.png',
    'tests/e2e/captures/reader-scroll.json',
    'tests/e2e/captures/README.md',
  ];
  const ignored = execFileSync('git', ['check-ignore', '--no-index', ...paths], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  assert.deepEqual(ignored, paths.slice(0, 5));
});

test('transitive production imports reconcile indirectly changed UI with state-owner journeys', () => {
  const graph = reverseDependencies(
    new Map([
      ['src/features/chat/ConnectedChat.tsx', "import { Chat } from './Chat';"],
      ['src/features/chat/Chat.tsx', "export { Message } from '../../shared/ui/Message';"],
      ['src/shared/ui/Message.tsx', "export { copy } from './copy';"],
      ['src/shared/ui/copy.ts', 'export const copy = "Send";'],
    ]),
  );
  const model = {
    owners: { chat: { source: ['src/features/chat/ConnectedChat.tsx'] } },
    journeys: [{ id: 'send', chain: ['chat'], cases: [{ id: 'recovery' }] }],
  };
  const policy = { protectedPrefixes: [], elevatedPrefixes: [], nonRuntimePrefixes: [] };
  const impact = classifyImpact(['src/shared/ui/copy.ts'], policy, model, graph);
  assert.deepEqual(impact.affectedJourneys, ['send/recovery']);
  assert.equal(impact.ui, true);
  assert.equal(affectedImporters(['src/shared/ui/copy.ts'], graph).size, 4);
});
test('relative directory exports, aliases and cyclic imports retain conservative reachability', () => {
  const graph = reverseDependencies(
    new Map([
      ['src/app.ts', "import './shared'; import('~/shared/index');"],
      ['src/shared/index.ts', "export * from '../app';"],
    ]),
  );
  assert.equal(affectedImporters(['src/shared/index.ts'], graph).size, 2);
});

test('undefined import graph returns the original paths without looping', () => {
  assert.deepEqual([...affectedImporters(['src/a.ts', 'src/b.ts'])], ['src/a.ts', 'src/b.ts']);
  assert.equal(affectedImporters([], undefined).size, 0);
});

test('documentation directory cannot hide executable MDX, rendered TSX or build hooks', () => {
  const policy = parsePolicy(
    readFileSync(
      new URL('../../.github/autonomous-maintenance-policy.yml', import.meta.url),
      'utf8',
    ),
  );
  const model = { owners: {}, journeys: [] };
  assert.equal(classifyImpact(['docs/guide.md'], policy, model).runtime, false);
  for (const file of ['docs/Page.tsx', 'docs/interactive.mdx']) {
    const impact = classifyImpact([file], policy, model);
    assert.equal(impact.runtime, true);
    assert.equal(impact.ui, true);
    assert.equal(impact.risk, 'elevated');
  }
  assert.equal(classifyImpact(['docs/vite.config.ts'], policy, model).risk, 'protected');
});

test('shared UI derives web and every reached native entry, rejecting implicit surface and entry omissions', () => {
  const file = 'src/shared/ui/Shared.tsx';
  const sources = new Map([
    [file, 'export const Shared = 1;'],
    ['web/main.tsx', "import '../src/shared/ui/Shared';"],
  ]);
  for (const entry of ['popup', 'sidepanel', 'options'])
    sources.set(`src/entrypoints/${entry}/main.tsx`, "import '../../shared/ui/Shared';");
  const graph = reverseDependencies(sources);
  const model = {
    owners: { shared: { source: [file] } },
    journeys: [{ id: 'render', chain: ['shared'], cases: [{ id: 'signed-out' }] }],
  };
  const policy = { protectedPrefixes: [], elevatedPrefixes: [], nonRuntimePrefixes: [] };
  const impact = classifyImpact([file], policy, model, graph);
  assert.deepEqual(impact.requiredUiSurfaces, ['web', 'extension']);
  assert.deepEqual(impact.requiredExtensionEntries, ['popup', 'sidepanel', 'options']);
  assert.equal(impact.uiScopeUnresolved, false);
  assert.equal(impact.risk, 'normal');
  const plan = (surface, entry) => ({
    surface,
    ...(entry ? { entry } : {}),
    route: '/#/account',
    scenario: 'signed-out-account',
    state: 'Device sign-in offered',
    account: 'signed-out',
    covers: [file],
    actions: [{ action: 'assertVisible', role: 'button', name: '登录 Lody' }],
  });
  const change = {
    type: 'fix',
    summary: 'Restore device sign-in control',
    user_impact: 'Device authorization can start from every surface',
    expected_path: 'Open account and authorize',
    negative_path: 'Signed-out surfaces retain the login control',
    release_note: 'Restore login access across product surfaces',
    breaking: false,
    surfaces: ['web'],
    affected_journeys: ['render/signed-out'],
    added_or_updated_journeys: ['render/signed-out'],
    evidence: { e2e: true, packaged_extension: true, screenshots: [plan('web')] },
    test_links: ['tests/e2e/features/identity-recovery.feature'],
  };
  const body = () =>
    `<!-- autonomous-intent:start -->\n\`\`\`json\n${JSON.stringify({ change })}\n\`\`\`\n<!-- autonomous-intent:end -->`;
  assert.throws(
    () => validateContract(body(), impact, model),
    /Implicit affected UI surface omitted: extension/,
  );
  assert.throws(() => validateImpactCapturePlans(change, impact), /missing required surface/);
  change.surfaces = ['web', 'extension', 'docs', 'sdk'];
  change.evidence.screenshots = [
    plan('web'),
    plan('extension', 'popup'),
    plan('extension', 'sidepanel'),
  ];
  assert.throws(
    () => validateImpactCapturePlans(change, impact),
    /extension entry omitted: options/,
  );
  change.evidence.screenshots.push(plan('extension', 'options'));
  assert.equal(validateContract(body(), impact, model).type, 'fix');
  const checked = validateImpactCapturePlans(change, impact);
  assert.deepEqual(checked.planOptions.requiredSurfaces, ['web', 'extension']);
  assert.equal(checked.capturePlans.length, 4);
});
test('entry-specific reachability stays precise and unresolved source scope requires review of both product surfaces', () => {
  const policy = { protectedPrefixes: [], elevatedPrefixes: [], nonRuntimePrefixes: [] };
  const model = { owners: {}, journeys: [] };
  const options = classifyImpact(['src/entrypoints/options/main.tsx'], policy, model);
  assert.deepEqual(options.requiredUiSurfaces, ['extension']);
  assert.deepEqual(options.requiredExtensionEntries, ['options']);
  assert.equal(options.unknown, false);
  const web = classifyImpact(['web/main.tsx'], policy, model);
  assert.deepEqual(web.requiredUiSurfaces, ['web']);
  assert.deepEqual(web.requiredExtensionEntries, []);
  assert.equal(web.unknown, false);
  const unresolved = classifyImpact(['src/shared/new-control.tsx'], policy, model);
  assert.deepEqual(unresolved.requiredUiSurfaces, ['web', 'extension']);
  assert.deepEqual(unresolved.requiredExtensionEntries, ['popup', 'sidepanel', 'options']);
  assert.equal(unresolved.uiScopeUnresolved, true);
  assert.equal(unresolved.unknown, true);
  assert.equal(unresolved.risk, 'elevated');
});
test('protected graph loads the actual web entrypoint alongside extension sources', async () => {
  const graph = await loadImpactGraph();
  assert.ok(graph.get('src/app/mount.tsx')?.has('web/main.tsx'));
});
