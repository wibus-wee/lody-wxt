import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// Node-only tooling runs independently of Vitest Browser Mode.
import test from 'node:test';

import {
  captureViewports,
  exactRevision,
  recordBuild,
  serveBuild,
  verifyBuild,
} from './capture-ui.mjs';

test('capture supports bounded desktop/mobile viewports and exact revision identities', () => {
  assert.equal(captureViewports.length, 2);
  assert.ok(captureViewports.every((item) => item.width > 0 && item.height > 0));
  assert.throws(() => exactRevision('.', 'HEAD'), /Full revision/);
});
test('serves built bytes and refuses missing build or absent assets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lody-ui-capture-'));
  let server;
  try {
    await assert.rejects(serveBuild(directory));
    await mkdir(path.join(directory, 'dist/web'), { recursive: true });
    await writeFile(path.join(directory, 'dist/web/index.html'), '<title>built candidate</title>');
    server = await serveBuild(directory, 0);
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await (await fetch(origin)).text(), '<title>built candidate</title>');
    assert.equal((await fetch(`${origin}/missing.js`)).status, 404);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('exact revision rejects tracked, staged and untracked source drift while allowing generated reports', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lody-exact-source-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    git('init');
    await writeFile(path.join(directory, '.gitignore'), 'dist/\nreports/\n');
    await writeFile(path.join(directory, 'source.ts'), 'export const answer = 1;\n');
    await writeFile(path.join(directory, 'COVERAGE.md'), 'old report\n');
    git('add', '.');
    git(
      '-c',
      'user.name=Capture test',
      '-c',
      'user.email=capture@example.test',
      'commit',
      '-m',
      'fixture',
    );
    const sha = git('rev-parse', 'HEAD');
    assert.ok(exactRevision(directory, sha));
    await writeFile(path.join(directory, 'COVERAGE.md'), 'generated report\n');
    await mkdir(path.join(directory, 'reports'));
    await writeFile(path.join(directory, 'reports/run.json'), '{}');
    assert.ok(exactRevision(directory, sha));
    await writeFile(path.join(directory, 'source.ts'), 'export const answer = 2;\n');
    assert.throws(() => exactRevision(directory, sha), /tracked source|untracked source/);
    git('add', 'source.ts');
    assert.throws(() => exactRevision(directory, sha), /tracked source|untracked source/);
    git('reset', '--hard', 'HEAD');
    await writeFile(
      path.join(directory, 'new-fixture.ts'),
      'export const unconditionalSuccess = true;\n',
    );
    assert.throws(() => exactRevision(directory, sha), /tracked source|untracked source/);
    await rm(path.join(directory, 'new-fixture.ts'));
    await mkdir(path.join(directory, 'dist/web'), { recursive: true });
    await writeFile(path.join(directory, 'dist/web/index.html'), '<title>actual build</title>');
    await assert.rejects(verifyBuild(directory, sha), /ENOENT/);
    await recordBuild(directory, sha);
    assert.equal((await verifyBuild(directory, sha)).sha, sha);
    await writeFile(
      path.join(directory, 'dist/web/index.html'),
      '<title>substituted build</title>',
    );
    await assert.rejects(verifyBuild(directory, sha), /receipt/);
    await writeFile(path.join(directory, 'dist/web/index.html'), '<title>actual build</title>');
    await writeFile(path.join(directory, 'dist/web/injected.js'), 'alert(1)');
    await assert.rejects(verifyBuild(directory, sha), /receipt/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('exact revision rejects modified submodule worktrees and changed gitlinks', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lody-exact-gitlink-'));
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = (cwd) =>
    git(
      cwd,
      '-c',
      'user.name=Capture test',
      '-c',
      'user.email=capture@example.test',
      'commit',
      '-am',
      'fixture',
    );
  try {
    const upstream = path.join(directory, 'upstream');
    const checkout = path.join(directory, 'checkout');
    await mkdir(upstream);
    await mkdir(checkout);
    git(upstream, 'init');
    await writeFile(path.join(upstream, 'ui.ts'), 'export const version = 1;\n');
    git(upstream, 'add', '.');
    commit(upstream);
    git(checkout, 'init');
    git(checkout, '-c', 'protocol.file.allow=always', 'submodule', 'add', upstream, 'vendor/ui');
    commit(checkout);
    const sha = git(checkout, 'rev-parse', 'HEAD');
    assert.ok(exactRevision(checkout, sha));
    const submodule = path.join(checkout, 'vendor/ui');
    git(checkout, 'config', 'submodule.vendor/ui.ignore', 'all');
    await writeFile(path.join(submodule, 'ui.ts'), 'export const version = 2;\n');
    assert.throws(() => exactRevision(checkout, sha), /tracked source|untracked source/);
    commit(submodule);
    assert.throws(() => exactRevision(checkout, sha), /tracked source|untracked source/);
    git(checkout, 'add', 'vendor/ui');
    assert.throws(() => exactRevision(checkout, sha), /tracked source|untracked source/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('protected fixture binding includes controller, dependencies and authenticated source tree', async () => {
  const { computeTrustedFixtureHash, trustedFixtureInputs } = await import('./capture-ui.mjs');
  const files = new Map(trustedFixtureInputs.map((file) => [file, `protected source: ${file}`]));
  const readProtected = async (file) => files.get(file);
  const hash = await computeTrustedFixtureHash('a'.repeat(40), readProtected);
  assert.equal(hash, await computeTrustedFixtureHash('a'.repeat(40), readProtected));
  assert.notEqual(hash, await computeTrustedFixtureHash('b'.repeat(40), readProtected));
  files.set('tests/e2e/support/account-boundary.ts', 'changed fixture');
  assert.notEqual(hash, await computeTrustedFixtureHash('a'.repeat(40), readProtected));
  await assert.rejects(computeTrustedFixtureHash('HEAD', readProtected), /Protected source tree/);
});

const declaredPlan = () => ({
  surface: 'web',
  route: '/#/settings',
  scenario: 'saved-appearance',
  state: 'Appearance settings remain visible with the declared theme',
  account: 'signed-in',
  covers: ['src/features/preferences/model.ts'],
  actions: [{ action: 'assertVisible', role: 'combobox', name: '主题' }],
});
test('data-only plans bind real routes, declared states, affected paths and extension entrypoints', async () => {
  const { validateCapturePlans, capturePlanHash } = await import('./capture-ui.mjs');
  const web = declaredPlan();
  const installed = {
    ...declaredPlan(),
    surface: 'extension',
    entry: 'sidepanel',
    route: '/#/conversations',
    scenario: 'restored-conversation',
  };
  const plans = [web, installed];
  const options = {
    requiredSurfaces: ['web', 'extension'],
    changedPaths: web.covers,
    requiredPaths: web.covers,
  };
  assert.equal(validateCapturePlans(plans, options), plans);
  const cleared = declaredPlan();
  cleared.actions = [
    { action: 'fill', role: 'textbox', name: 'Draft', value: '' },
    { action: 'assertValue', role: 'textbox', name: 'Draft', value: '' },
  ];
  assert.ok(validateCapturePlans([cleared]));
  const hash = capturePlanHash(plans, options);
  assert.equal(hash, capturePlanHash(structuredClone(plans), options));
  const changed = structuredClone(plans);
  changed[1].entry = 'popup';
  assert.notEqual(hash, capturePlanHash(changed, options));
  assert.throws(() => validateCapturePlans([web], options), /missing required surface/);
  assert.throws(
    () => validateCapturePlans(plans, { changedPaths: ['src/other.ts'] }),
    /unrelated changed-path/,
  );
  assert.throws(
    () => validateCapturePlans(plans, { requiredPaths: ['src/other.ts'] }),
    /Affected paths omitted/,
  );
});
test('plan validation rejects execution shortcuts, external routes, empty assertions and unbounded inputs', async () => {
  const { validateCapturePlans } = await import('./capture-ui.mjs');
  assert.throws(() => validateCapturePlans([]), /declared capture plans/);
  for (const change of [
    (p) => {
      p.route = 'https://example.com';
    },
    (p) => {
      p.state = '';
    },
    (p) => {
      p.actions = [{ action: 'evaluate', code: 'return true' }];
    },
    (p) => {
      p.actions = [{ action: 'assertVisible', role: 'button', name: 'Save', selector: 'body' }];
    },
    (p) => {
      p.actions = [{ action: 'navigate', route: 'javascript:alert(1)' }];
    },
    (p) => {
      p.actions = [{ action: 'click', role: 'button', name: 'Save' }];
    },
    (p) => {
      p.actions = [{ action: 'press', role: 'textbox', name: 'Draft', key: 'F12' }];
    },
    (p) => {
      p.actions = Array.from({ length: 31 }).fill({
        action: 'assertVisible',
        role: 'button',
        name: 'Save',
      });
    },
    (p) => {
      p.account = 'injected-storage';
    },
    (p) => {
      p.surface = 'extension';
      p.entry = '../../node';
    },
  ]) {
    const plan = declaredPlan();
    change(plan);
    assert.throws(() => validateCapturePlans([plan]));
  }
  const secret = declaredPlan();
  secret.state = `ghp_${'a'.repeat(40)}`;
  assert.throws(() => validateCapturePlans([secret]), /Credential-like data/);
});
test('installed extension plans require matching packaged bytes rather than web-only receipts', async () => {
  const { verifyBuildArtifact } = await import('./capture-ui.mjs');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lody-packaged-capture-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    git('init');
    await writeFile(path.join(directory, '.gitignore'), 'dist/\n.output/\n');
    git('add', '.');
    git(
      '-c',
      'user.name=Capture test',
      '-c',
      'user.email=capture@example.test',
      'commit',
      '-m',
      'fixture',
    );
    const sha = git('rev-parse', 'HEAD');
    const tree = git('rev-parse', 'HEAD^{tree}');
    await mkdir(path.join(directory, 'dist/web'), { recursive: true });
    await writeFile(path.join(directory, 'dist/web/index.html'), '<title>web</title>');
    await recordBuild(directory, sha);
    await assert.rejects(
      verifyBuildArtifact(directory, sha, tree, { extension: true }),
      /extension inventory/,
    );
    await mkdir(path.join(directory, '.output/chrome-mv3'), { recursive: true });
    await writeFile(
      path.join(directory, '.output/chrome-mv3/manifest.json'),
      '{"manifest_version":3}',
    );
    await writeFile(
      path.join(directory, '.output/chrome-mv3/sidepanel.html'),
      '<title>installed panel</title>',
    );
    await recordBuild(directory, sha);
    assert.ok(
      (await verifyBuildArtifact(directory, sha, tree, { extension: true })).extensionFiles
        .length === 2,
    );
    await writeFile(
      path.join(directory, '.output/chrome-mv3/sidepanel.html'),
      '<title>tampered panel</title>',
    );
    await assert.rejects(
      verifyBuildArtifact(directory, sha, tree, { extension: true }),
      /extension inventory/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('new or changed UI can declare an explicit real before state without inventing old controls', async () => {
  const { validateCapturePlans, capturePlanHash } = await import('./capture-ui.mjs');
  const plan = declaredPlan();
  plan.route = '/#/new-settings';
  plan.state = 'New settings control is available';
  plan.actions = [{ action: 'assertVisible', role: 'button', name: 'New settings control' }];
  plan.before = {
    route: '/#/settings',
    state: 'Previous settings screen before the new control existed',
    account: 'signed-in',
    actions: [
      { action: 'assertAbsent', role: 'button', name: 'New settings control' },
      { action: 'assertVisible', role: 'combobox', name: '主题' },
    ],
  };
  assert.ok(validateCapturePlans([plan]));
  const old = capturePlanHash([plan]);
  const changed = structuredClone(plan);
  changed.before.state = 'Different baseline';
  assert.notEqual(old, capturePlanHash([changed]));
  const emptyBefore = structuredClone(plan);
  emptyBefore.before.actions.pop();
  assert.throws(() => validateCapturePlans([emptyBefore]), /terminal visible-state assertion/);
  const shortcut = structuredClone(plan);
  shortcut.before.actions[0] = { action: 'evaluate', code: 'true' };
  assert.throws(() => validateCapturePlans([shortcut]), /Unsupported capture action/);
});

test('source screenshots use only fixed installed-extension fixtures and bind their outcome', async () => {
  const { validateCapturePlans, capturePlanHash } = await import('./capture-ui.mjs');
  const plan = {
    ...declaredPlan(),
    surface: 'extension',
    entry: 'sidepanel',
    sourceScreenshot: 'overlay',
  };
  assert.ok(validateCapturePlans([plan]));
  assert.notEqual(
    capturePlanHash([plan]),
    capturePlanHash([{ ...plan, sourceScreenshot: 'blocked' }]),
  );
  for (const change of [
    { surface: 'web' },
    { entry: 'popup' },
    { account: 'signed-out' },
    { sourceScreenshot: 'https://example.com' },
    { sourceScreenshot: { html: '<script />' } },
    { sourceUrl: 'https://example.com' },
  ])
    assert.throws(() => validateCapturePlans([{ ...plan, ...change }]));
  const before = {
    route: plan.route,
    state: 'Existing explicit rejection',
    account: plan.account,
    actions: plan.actions,
    sourceScreenshot: 'blocked',
  };
  assert.ok(validateCapturePlans([{ ...plan, before }]));
  assert.throws(() =>
    validateCapturePlans([{ ...plan, before: { ...before, sourceScreenshot: 'arbitrary' } }]),
  );
});

test('native directory preparation accepts only fixed installed expired settings state', async () => {
  const { validateCapturePlans, capturePlanHash } = await import('./capture-ui.mjs');
  const plan = {
    surface: 'extension',
    entry: 'options',
    route: '/#/settings?section=updates',
    scenario: 'directory-expired',
    state: 'Saved directory with revoked grant',
    account: 'signed-out',
    directoryPermission: 'expired',
    covers: ['src/features/updates/DirectoryUpdate.tsx'],
    actions: [{ action: 'assertVisible', role: 'region', name: '目录更新' }],
  };
  assert.equal(validateCapturePlans([plan])[0], plan);
  assert.notEqual(
    capturePlanHash([plan]),
    capturePlanHash([{ ...plan, directoryPermission: undefined }]),
  );
  for (const change of [
    { surface: 'web', entry: undefined },
    { entry: 'popup' },
    { account: 'signed-in' },
    { directoryPermission: 'granted' },
    { directoryPermission: { path: '/tmp' } },
    { route: '/#/account' },
    { sourceScreenshot: 'overlay' },
  ])
    assert.throws(() => validateCapturePlans([{ ...plan, ...change }]));
  assert.throws(() =>
    validateCapturePlans([
      {
        ...plan,
        before: {
          route: plan.route,
          state: 'Invalid override',
          account: 'signed-out',
          actions: plan.actions,
          directoryPermission: 'granted',
        },
      },
    ]),
  );
});
