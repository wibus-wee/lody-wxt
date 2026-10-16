import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { prepareExpiredDirectory } from './capture-directory.mjs';
import { canonical } from './common.mjs';
import { resolveIntent } from './contract.mjs';
import { contentHash, validateScreenshotManifest } from './screenshot-manifest.mjs';
import { scanDiffSecrets } from './secrets.mjs';
import { assertCleanSnapshot } from './snapshot.mjs';

const generalCategoryName = /^通用(?:\s|$)/;

// Both layouts must use the real theme control. Wait for hydration before
// choosing a path; a hidden control in a narrow category view is not ready.
export async function selectCaptureTheme(page, theme, assertion) {
  if (!['light', 'dark'].includes(theme)) throw new Error('Unsupported capture theme');
  const control = page.getByRole('combobox', { name: '主题', exact: true });
  const general = page
    .getByRole('navigation', { name: '设置分类', exact: true })
    .getByRole('button', { name: generalCategoryName });
  await assertion(control.or(general).filter({ visible: true }).first()).toBeVisible();
  if (!(await control.isVisible())) await general.click();
  await assertion(control).toBeVisible();
  await control.click();
  await page
    .getByRole('option', { name: theme === 'light' ? '浅色' : '深色', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await assertion(page.locator('main')).toHaveAttribute('data-theme', theme);
}

export const captureViewports = Object.freeze([
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]);
const internalRoute = /^\/#\/[\w/-]*(?:\?[\w=&%.-]*)?$/;
const scenarioName = /^[a-z0-9][a-z0-9-]{0,79}$/;
const safeRoles = new Set([
  'button',
  'textbox',
  'combobox',
  'option',
  'tab',
  'checkbox',
  'switch',
  'link',
  'radio',
  'menuitem',
  'heading',
  'dialog',
  'status',
  'alert',
  'listitem',
  'img',
  'region',
  'list',
  'treeitem',
]);
const safeKeys = new Set([
  'Enter',
  'Escape',
  'Tab',
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Backspace',
  'Delete',
  'Control+A',
  'Meta+A',
  'Shift+Enter',
]);
const actionFields = {
  click: ['action', 'role', 'name'],
  fill: ['action', 'role', 'name', 'value'],
  press: ['action', 'role', 'name', 'key'],
  check: ['action', 'role', 'name'],
  uncheck: ['action', 'role', 'name'],
  navigate: ['action', 'route'],
  assertVisible: ['action', 'role', 'name'],
  assertText: ['action', 'role', 'name', 'value'],
  assertValue: ['action', 'role', 'name', 'value'],
  assertEnabled: ['action', 'role', 'name'],
  assertChecked: ['action', 'role', 'name'],
  assertAbsent: ['action', 'role', 'name'],
};
const boundedText = (value, max = 200) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= max &&
  !value.includes('\0');
export function validateCapturePlans(
  plans,
  { requiredSurfaces, changedPaths, requiredPaths } = {},
) {
  for (const paths of [changedPaths, requiredPaths])
    if (
      paths !== undefined &&
      (!Array.isArray(paths) ||
        paths.length > 3000 ||
        paths.some((file) => typeof file !== 'string'))
    )
      throw new Error('Authenticated changed/affected path arrays required');
  if (
    !Array.isArray(plans) ||
    plans.length < 1 ||
    plans.length > 12 ||
    Buffer.byteLength(JSON.stringify(plans)) > 32000
  )
    throw new Error('Meaningful declared capture plans required (1..12, at most 32 KB)');
  if (scanDiffSecrets([{ filename: 'capture-plan', patch: `+${JSON.stringify(plans)}` }]).length)
    throw new Error('Credential-like data must not enter capture plans');
  const identities = new Set();
  for (const plan of plans) {
    if (
      !plan ||
      Object.keys(plan).some(
        (field) =>
          ![
            'surface',
            'entry',
            'route',
            'scenario',
            'state',
            'account',
            'actions',
            'covers',
            'before',
            'sourceScreenshot',
            'directoryPermission',
          ].includes(field),
      ) ||
      !['web', 'extension'].includes(plan.surface) ||
      !internalRoute.test(plan.route ?? '') ||
      !scenarioName.test(plan.scenario ?? '') ||
      !boundedText(plan.state) ||
      !['signed-in', 'signed-out'].includes(plan.account) ||
      (plan.surface === 'extension'
        ? !['options', 'sidepanel', 'popup'].includes(plan.entry)
        : plan.entry !== undefined) ||
      !Array.isArray(plan.covers) ||
      !plan.covers.length ||
      plan.covers.length > 30 ||
      plan.covers.some(
        (file) =>
          !boundedText(file, 500) ||
          file.startsWith('/') ||
          file.includes('..') ||
          (changedPaths && !changedPaths.includes(file)),
      ) ||
      !Array.isArray(plan.actions) ||
      !plan.actions.length ||
      plan.actions.length > 30
    )
      throw new Error('Invalid data-only capture plan or unrelated changed-path coverage');
    if (
      plan.sourceScreenshot !== undefined &&
      (plan.surface !== 'extension' ||
        plan.entry !== 'sidepanel' ||
        plan.account !== 'signed-in' ||
        !['blocked', 'overlay'].includes(plan.sourceScreenshot))
    )
      throw new Error(
        'Source screenshot requires an installed signed-in sidepanel and fixed outcome',
      );
    if (
      plan.directoryPermission !== undefined &&
      (plan.directoryPermission !== 'expired' ||
        plan.surface !== 'extension' ||
        !['options', 'sidepanel'].includes(plan.entry) ||
        plan.account !== 'signed-out' ||
        plan.route !== '/#/settings?section=updates' ||
        plan.sourceScreenshot !== undefined)
    )
      throw new Error(
        'Directory permission fixture requires signed-out installed settings and fixed expired state',
      );
    const identity = JSON.stringify([plan.surface, plan.entry, plan.scenario]);
    if (identities.has(identity)) throw new Error('Duplicate capture plan');
    identities.add(identity);
    for (const step of plan.actions) {
      const allowed = actionFields[step?.action];
      if (
        !Object.hasOwn(actionFields, step?.action) ||
        !allowed ||
        Object.keys(step).some((field) => !allowed.includes(field))
      )
        throw new Error('Unsupported capture action');
      if (step.action === 'navigate') {
        if (!internalRoute.test(step.route ?? ''))
          throw new Error('Capture route must be internal hash route');
      } else if (!safeRoles.has(step.role) || !boundedText(step.name))
        throw new Error('Capture actions require exact accessible role/name');
      if (
        ['fill', 'assertText', 'assertValue'].includes(step.action) &&
        (typeof step.value !== 'string' ||
          step.value.length > 2000 ||
          step.value.includes('\0') ||
          (step.action === 'assertText' && !step.value.trim()))
      )
        throw new Error('Bounded capture action value required');
      if (step.action === 'press' && !safeKeys.has(step.key))
        throw new Error('Unsupported capture key');
    }
    if (
      !plan.actions.at(-1).action.startsWith('assert') ||
      plan.actions.at(-1).action === 'assertAbsent'
    )
      throw new Error('Capture scenario requires a terminal visible-state assertion');
    if (plan.before !== undefined) {
      if (
        !plan.before ||
        Object.keys(plan.before).some(
          (field) =>
            ![
              'route',
              'state',
              'account',
              'actions',
              'sourceScreenshot',
              'directoryPermission',
            ].includes(field),
        ) ||
        !['route', 'state', 'account', 'actions'].every((field) =>
          Object.hasOwn(plan.before, field),
        )
      )
        throw new Error(
          'Explicit before scenario requires route, state, account and typed actions',
        );
      const baseline = { ...plan, ...plan.before };
      delete baseline.before;
      validateCapturePlans([baseline], { changedPaths });
    }
  }
  if (
    requiredSurfaces !== undefined &&
    (!Array.isArray(requiredSurfaces) ||
      requiredSurfaces.some((surface) => !plans.some((plan) => plan.surface === surface)))
  )
    throw new Error('Declared capture plan missing required surface');
  if (
    requiredPaths &&
    requiredPaths.some((file) => !plans.some((plan) => plan.covers.includes(file)))
  )
    throw new Error('Affected paths omitted from capture plan');
  return plans;
}
export const capturePlanHash = (plans, options) =>
  contentHash(canonical(validateCapturePlans(plans, options)));
export async function configureCaptureClock(page, surface) {
  // Extension RPC deadlines are checked by a real-time service worker. Keep
  // the page on that same wall clock instead of moving it into the past.
  if (surface === 'extension') return;
  if (surface !== 'web') throw new Error('Unsupported capture clock surface');
  await page.clock.install({ time: new Date('2026-06-01T12:00:00Z') });
}
export async function executeCaptureActions(page, plan, expect, urlFor) {
  for (const step of plan.actions) {
    if (step.action === 'navigate') {
      await page.goto(urlFor(step.route));
      continue;
    }
    const target = page.getByRole(step.role, { name: step.name, exact: true });
    if (step.action.startsWith('assert') && step.action !== 'assertAbsent')
      await target.scrollIntoViewIfNeeded();
    if (step.action === 'click') await target.click();
    else if (step.action === 'fill') await target.fill(step.value);
    else if (step.action === 'press') await target.press(step.key);
    else if (step.action === 'check') await target.check();
    else if (step.action === 'uncheck') await target.uncheck();
    else if (step.action === 'assertVisible') await expect(target).toBeVisible();
    else if (step.action === 'assertText') await expect(target).toContainText(step.value);
    else if (step.action === 'assertValue') await expect(target).toHaveValue(step.value);
    else if (step.action === 'assertEnabled') await expect(target).toBeEnabled();
    else if (step.action === 'assertChecked') await expect(target).toBeChecked();
    else if (step.action === 'assertAbsent') await expect(target).toHaveCount(0);
    else throw new Error('Unsupported capture action');
  }
}
// Candidate plans select a fixed outcome, never source bytes, URLs or scripts.
export async function captureSourceScreenshot(context, panel, outcome, expect) {
  if (!['blocked', 'overlay'].includes(outcome)) throw new Error('Invalid screenshot outcome');
  const url = 'https://backend.lody.ai/autonomy-screenshot-source';
  await context.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><title>Public screenshot fixture</title><style>body{margin:16px;background:#f05028}input{display:block;max-width:90vw}</style><h1>Public screenshot fixture</h1><label>Password<input type="password" aria-label="Fixture password"></label><label>Code<input autocomplete="one-time-code" aria-label="Fixture code"></label><p data-sensitive>Public synthetic marker; all inputs are empty.</p></html>',
    }),
  );
  const source = await context.newPage();
  source.setDefaultTimeout(10000);
  await source.goto(url);
  await source.bringToFront();
  const session = await context.browser().newBrowserCDPSession();
  try {
    const { targetInfos } = await session.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const target = targetInfos.find((item) => item.url === url);
    if (!target) throw new Error('Exact screenshot source tab missing');
    await session.send('Extensions.triggerAction', {
      id: new URL(panel.url()).host,
      targetId: target.targetId,
    });
  } finally {
    await session.detach();
  }
  await expect(source.getByLabel('Fixture password', { exact: true })).toBeVisible();
  await expect(source.getByLabel('Fixture password', { exact: true })).toHaveValue('');
  await expect(source.getByLabel('Fixture code', { exact: true })).toBeVisible();
  await expect(source.getByLabel('Fixture code', { exact: true })).toHaveValue('');
  await panel.getByRole('button', { name: '附加上下文', exact: true }).click();
  await panel.getByRole('menuitem', { name: '截图并裁剪…', exact: true }).click();
  const overlay = source.getByRole('dialog', { name: '截取可见内容', exact: true });
  if (outcome === 'blocked') {
    await expect(panel.getByRole('alert')).toContainText('当前可见区域包含密码、验证码或敏感内容');
    await expect(overlay).toHaveCount(0);
    return panel;
  }
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole('button', { name: '附加整张截图', exact: true })).toBeVisible();
  await expect(overlay.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  return source;
}
const fullSha = /^[a-f0-9]{40}$/;
const positiveId = /^[1-9]\d*$/;
const cliName = /-([a-z])/g;
export function exactRevision(directory, expected) {
  if (!fullSha.test(expected ?? '')) throw new Error('Full revision SHA required');
  const actual = assertCleanSnapshot(directory);
  if (actual !== expected) throw new Error('Checkout does not match exact revision');
  return execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: directory,
    encoding: 'utf8',
  }).trim();
}

const receiptName = '.autonomy-build.json';
async function buildInventory(directory, relativeRoot = 'dist/web') {
  const root = path.join(await realpath(directory), relativeRoot);
  if ((await realpath(root)) !== root) throw new Error('Built UI root must not traverse symlinks');
  const files = [];
  async function visit(relative = '') {
    for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Built UI must not contain symlinks');
      if (relativeRoot === 'dist/web' && name === receiptName) continue;
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile())
        files.push({ path: name, contentHash: contentHash(await readFile(path.join(root, name))) });
      else throw new Error('Built UI contains nonregular files');
      if (files.length > 10000) throw new Error('Built UI inventory exceeds bound');
    }
  }
  await visit();
  if (
    !files.some(
      (file) => file.path === (relativeRoot === 'dist/web' ? 'index.html' : 'manifest.json'),
    )
  )
    throw new Error('Built UI entry missing');
  return files;
}
export async function recordBuild(directory, sha) {
  const treeSha = exactRevision(directory, sha);
  const receipt = { schemaVersion: 1, sha, treeSha, files: await buildInventory(directory) };
  try {
    receipt.extensionFiles = await buildInventory(directory, '.output/chrome-mv3');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  exactRevision(directory, sha);
  await writeFile(
    path.join(directory, 'dist/web', receiptName),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}
export async function verifyBuildArtifact(directory, sha, treeSha, { extension = false } = {}) {
  if (!fullSha.test(sha ?? '') || !fullSha.test(treeSha ?? ''))
    throw new Error('Authenticated artifact source SHA/tree required');
  const receipt = JSON.parse(await readFile(path.join(directory, 'dist/web', receiptName), 'utf8'));
  if (
    receipt.schemaVersion !== 1 ||
    receipt.sha !== sha ||
    receipt.treeSha !== treeSha ||
    JSON.stringify(receipt.files) !== JSON.stringify(await buildInventory(directory))
  )
    throw new Error('Built UI receipt does not match authenticated source/build bytes');
  if (
    extension &&
    (!receipt.extensionFiles ||
      JSON.stringify(receipt.extensionFiles) !==
        JSON.stringify(await buildInventory(directory, '.output/chrome-mv3')))
  )
    throw new Error('Installed extension inventory mismatch');
  return receipt;
}
export const trustedFixtureInputs = [
  'tests/e2e/support/account-boundary.ts',
  'tests/e2e/support/runtime-boundary.ts',
  'tests/e2e/support/sharing-boundary.ts',
  'tests/e2e/support/shortcut-boundary.ts',
  'tools/autonomy/capture-ui.mjs',
  'tools/autonomy/capture-directory.mjs',
  'tools/autonomy/screenshot-manifest.mjs',
  'tools/autonomy/snapshot.mjs',
  'tools/autonomy/common.mjs',
  'tools/autonomy/contract.mjs',
  'tools/autonomy/secrets.mjs',
  'pnpm-lock.yaml',
];
export async function computeTrustedFixtureHash(treeSha, readProtected) {
  if (!fullSha.test(treeSha ?? '') || typeof readProtected !== 'function')
    throw new Error('Protected source tree and reader required');
  const files = await Promise.all(
    trustedFixtureInputs.map(async (file) => ({
      path: file,
      contentHash: contentHash(await readProtected(file)),
    })),
  );
  return contentHash(JSON.stringify({ treeSha, files }));
}
export async function trustedFixtureHash(directory) {
  const treeSha = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: directory,
    encoding: 'utf8',
  }).trim();
  return computeTrustedFixtureHash(treeSha, (file) => readFile(path.join(directory, file)));
}
export async function verifyBuild(directory, sha, { extension = false } = {}) {
  const treeSha = exactRevision(directory, sha);
  const receipt = JSON.parse(await readFile(path.join(directory, 'dist/web', receiptName), 'utf8'));
  if (
    receipt.schemaVersion !== 1 ||
    receipt.sha !== sha ||
    receipt.treeSha !== treeSha ||
    JSON.stringify(receipt.files) !== JSON.stringify(await buildInventory(directory))
  )
    throw new Error('Built UI receipt does not match exact source/build bytes');
  if (
    extension &&
    (!receipt.extensionFiles ||
      JSON.stringify(receipt.extensionFiles) !==
        JSON.stringify(await buildInventory(directory, '.output/chrome-mv3')))
  )
    throw new Error('Installed extension inventory mismatch');
  exactRevision(directory, sha);
  return receipt;
}
export async function serveBuild(directory, port = 4173) {
  const root = await realpath(path.join(directory, 'dist/web'));
  await readFile(path.join(root, 'index.html'));
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = await realpath(path.join(root, pathname === '/' ? 'index.html' : pathname));
      if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Outside build');
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

async function localAccountBoundary(directory) {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      path.join(directory, 'key.pem'),
      '-out',
      path.join(directory, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=backend.lody.ai',
    ],
    { stdio: 'ignore' },
  );
  const received = [];
  const server = createHttpsServer(
    {
      key: await readFile(path.join(directory, 'key.pem')),
      cert: await readFile(path.join(directory, 'cert.pem')),
    },
    (request, response) => {
      received.push(request.url);
      response.setHeader('Content-Type', 'application/json');
      if (request.headers.cookie) {
        response.writeHead(400);
        response.end('{}');
        return;
      }
      const publicPaths = ['/api/auth/device/code', '/api/auth/device/token', '/verify'];
      if (
        !publicPaths.includes(request.url) &&
        request.headers.authorization !== 'Bearer capture-protocol-token'
      ) {
        response.writeHead(401);
        response.end('{}');
        return;
      }
      let body;
      if (request.url === '/api/auth/device/code')
        body = {
          device_code: 'capture-device',
          user_code: 'CAPTURE',
          verification_uri: 'https://backend.lody.ai/verify',
          verification_uri_complete: 'https://backend.lody.ai/verify?code=CAPTURE',
          expires_in: 300,
          interval: 1,
        };
      else if (request.url === '/api/auth/device/token')
        body = { access_token: 'capture-protocol-token', token_type: 'Bearer', expires_in: 3600 };
      else if (request.url === '/api/auth/get-session')
        body = {
          user: { id: 'user-a', email: 'test@example.test', name: 'Browser tester' },
          session: {
            id: 'session-a',
            userId: 'user-a',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        };
      else if (request.url === '/api/auth/organization/list')
        body = [
          { id: 'workspace-a', name: 'Test studio', slug: 'test-studio' },
          { id: 'workspace-b', name: 'Other studio', slug: 'other-studio' },
        ];
      else if (request.url === '/verify') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<title>Capture authorization</title><h1>Device authorization</h1>');
        return;
      } else {
        response.writeHead(404);
        response.end('{}');
        return;
      }
      response.end(JSON.stringify(body));
    },
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, received, port: server.address().port };
}

export async function captureUI({
  before,
  candidate,
  beforeSha,
  candidateSha,
  candidateTreeSha,
  output,
  sourceRunId,
  sourceRunAttempt,
  captureRunId,
  captureRunAttempt,
  sourceArtifactId,
  intentFile,
}) {
  const controllerRoot = await realpath(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  );
  if (controllerRoot !== (await realpath(before)))
    throw new Error('Capture controller must execute from the protected base checkout');
  const intentBytes = await readFile(intentFile);
  if (intentBytes.length > 1000000) throw new Error('Capture intent exceeds bound');
  const intent = JSON.parse(intentBytes);
  if (
    scanDiffSecrets([
      {
        filename: 'capture-intent',
        patch: String(intent.body)
          .split('\n')
          .map((line) => `+${line}`)
          .join('\n'),
      },
    ]).length
  )
    throw new Error('Credential-like data must not enter capture intent');
  const change = await resolveIntent(intent.body, async (file) => {
    if (file !== intent.capturePlanPath || typeof intent.capturePlanText !== 'string')
      throw new Error('Capture plan must come from authenticated candidate data');
    return intent.capturePlanText;
  });
  const plans = validateCapturePlans(change.evidence?.screenshots, {
    requiredSurfaces: change.surfaces.filter((surface) => ['web', 'extension'].includes(surface)),
    changedPaths: intent.files,
  });
  const policy = JSON.parse(
    await readFile(path.join(before, '.github/autonomous-maintenance-policy.yml'), 'utf8'),
  );
  const viewports = policy.screenshot?.viewports;
  const themes = policy.screenshot?.themes;
  if (
    !Array.isArray(viewports) ||
    !viewports.length ||
    viewports.length > 4 ||
    !Array.isArray(themes) ||
    !themes.length ||
    themes.some((theme) => !['light', 'dark'].includes(theme)) ||
    viewports.some(
      (v) =>
        !Number.isInteger(v.width) ||
        !Number.isInteger(v.height) ||
        v.width < 240 ||
        v.width > 2560 ||
        v.height < 240 ||
        v.height > 2560,
    )
  )
    throw new Error('Bounded protected capture matrix required');
  if (plans.length * viewports.length * themes.length * 2 > 128)
    throw new Error('Capture plan matrix exceeds image bound');
  const extension = plans.some((plan) => plan.surface === 'extension');
  const beforeBuild = await verifyBuild(before, beforeSha, { extension });
  const candidateBuild = await verifyBuildArtifact(candidate, candidateSha, candidateTreeSha, {
    extension,
  });
  const provenance = {
    sourceRunId,
    sourceRunAttempt,
    captureRunId,
    captureRunAttempt,
    sourceArtifactId,
  };
  if (Object.values(provenance).some((value) => !positiveId.test(String(value ?? ''))))
    throw new Error('Authenticated build/capture run and artifact identities required');
  const fixtureHash = await trustedFixtureHash(before);
  const { chromium, expect } = await import('@playwright/test');
  const { AccountBoundary, signIn } = await import(
    pathToFileURL(path.join(before, 'tests/e2e/support/account-boundary.ts')).href
  );
  const { RuntimeBoundary } = await import(
    pathToFileURL(path.join(before, 'tests/e2e/support/runtime-boundary.ts')).href
  );
  await mkdir(output, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    fixtureHash,
    planHash: capturePlanHash(plans),
    plans,
    captures: [],
    builds: {},
    captureContext: {
      ...provenance,
      controllerSha: beforeSha,
      candidateTreeSha,
      baseTreeSha: beforeBuild.treeSha,
    },
  };
  for (const [role, receipt] of [
    ['before', beforeBuild],
    ['candidate', candidateBuild],
  ]) {
    const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
    await writeFile(path.join(output, `${role}-build.json`), bytes);
    manifest.builds[role] = {
      sha: receipt.sha,
      treeSha: receipt.treeSha,
      path: `${role}-build.json`,
      contentHash: contentHash(bytes),
    };
  }
  const browser = await chromium.launch();
  try {
    for (const [role, directory, sha] of [
      ['before', before, beforeSha],
      ['candidate', candidate, candidateSha],
    ]) {
      const server = await serveBuild(directory);
      try {
        for (const declared of plans)
          for (const viewport of viewports)
            for (const theme of themes) {
              const plan =
                role === 'before' && declared.before
                  ? { ...declared, ...declared.before }
                  : declared;
              const temporary = await mkdtemp(path.join(tmpdir(), 'lody-capture-'));
              let accountBoundary;
              let context;
              let page;
              const name = `${role}-${plan.surface}-${plan.entry ?? 'app'}-${plan.scenario}-${viewport.width}x${viewport.height}-${theme}`;
              try {
                const settings = {
                  viewport,
                  colorScheme: theme,
                  reducedMotion: 'reduce',
                  locale: 'en-US',
                  timezoneId: 'UTC',
                };
                let origin = 'http://127.0.0.1:4173';
                let entry = '';
                const ownership = [];
                if (plan.surface === 'extension') {
                  accountBoundary = await localAccountBoundary(temporary);
                  const sourceInstalled = path.resolve(directory, '.output/chrome-mv3');
                  const installed = plan.directoryPermission
                    ? path.join(temporary, 'installed')
                    : sourceInstalled;
                  if (plan.directoryPermission) {
                    await cp(sourceInstalled, installed, { recursive: true });
                    if (
                      JSON.stringify(await buildInventory(temporary, 'installed')) !==
                      JSON.stringify(await buildInventory(directory, '.output/chrome-mv3'))
                    )
                      throw new Error('Disposable installed copy differs from verified build');
                  }
                  context = await chromium.launchPersistentContext(
                    path.join(temporary, 'profile'),
                    {
                      ...settings,
                      channel: 'chromium',
                      headless: !plan.directoryPermission,
                      args: [
                        `--disable-extensions-except=${installed}`,
                        `--load-extension=${installed}`,
                        ...(plan.sourceScreenshot ? ['--enable-unsafe-extension-debugging'] : []),
                        '--ignore-certificate-errors',
                        '--no-proxy-server',
                        `--host-resolver-rules=MAP backend.lody.ai 127.0.0.1:${accountBoundary.port}`,
                      ],
                    },
                  );
                  context.on('request', (request) => {
                    if (
                      request.url().includes('backend.lody.ai/api/auth/') &&
                      !request.url().includes('/convex/') &&
                      !request.url().includes('/loro-streams/')
                    )
                      ownership.push(request.serviceWorker() !== null);
                  });
                  const worker =
                    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
                  origin = `chrome-extension://${new URL(worker.url()).host}`;
                  entry = `${plan.entry}.html`;
                  if (plan.directoryPermission) {
                    const result = await prepareExpiredDirectory(
                      context,
                      origin,
                      installed,
                      path.join(output, name),
                      expect,
                    );
                    if (
                      JSON.stringify(await buildInventory(temporary, 'installed')) !==
                      JSON.stringify(await buildInventory(directory, '.output/chrome-mv3'))
                    )
                      throw new Error('Native fixture changed installed build bytes');
                    await writeFile(
                      path.join(output, `${name}.directory.json`),
                      `${JSON.stringify(result, null, 2)}\n`,
                    );
                  }
                } else {
                  context = await browser.newContext(settings);
                  await new AccountBoundary().install(context);
                }
                await new RuntimeBoundary({ modeOption: 'modeId' }).install(context);
                await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
                const setup = await context.newPage();
                page = setup;
                setup.setDefaultTimeout(10000);
                const optionsUrl = plan.surface === 'extension' ? `${origin}/options.html` : origin;
                await setup.goto(`${optionsUrl}/#/account`.replace('.html/#', '.html#'));
                if (plan.account === 'signed-in') await signIn(setup);
                await setup.getByRole('button', { name: 'Settings', exact: true }).click();
                await selectCaptureTheme(setup, theme, expect);
                page = plan.surface === 'extension' ? await context.newPage() : setup;
                page.setDefaultTimeout(10000);
                await configureCaptureClock(page, plan.surface);
                const urlFor = (route) => `${origin}/${entry}${route.slice(1)}`;
                await page.goto(urlFor(plan.route));
                await executeCaptureActions(page, plan, expect, urlFor);
                if (
                  !page.url().startsWith(`${origin}/`) ||
                  new URL(page.url()).hash !== plan.route.slice(1)
                )
                  throw new Error('Capture left the declared internal route');
                await expect(page.locator('main')).toHaveAttribute('data-theme', theme);
                if (plan.surface === 'extension' && plan.account === 'signed-in') {
                  if (
                    !accountBoundary.received.includes('/api/auth/device/code') ||
                    !accountBoundary.received.includes('/api/auth/get-session') ||
                    ownership.length < 4 ||
                    ownership.some((workerOwned) => !workerOwned)
                  )
                    throw new Error(
                      'Installed extension account protocol did not traverse its real service worker',
                    );
                }
                const capturePage = plan.sourceScreenshot
                  ? await captureSourceScreenshot(context, page, plan.sourceScreenshot, expect)
                  : page;
                await capturePage.evaluate(() => document.fonts.ready);
                const bytes = await capturePage.screenshot({
                  path: path.join(output, `${name}.png`),
                  animations: 'disabled',
                });
                manifest.captures.push({
                  role,
                  sha,
                  surface: plan.surface,
                  entry: plan.entry,
                  route: plan.route,
                  scenario: plan.scenario,
                  state: plan.state,
                  viewport,
                  theme,
                  path: `${name}.png`,
                  contentHash: contentHash(bytes),
                });
                await context.tracing.stop({ path: path.join(output, `${name}.trace.zip`) });
              } catch (error) {
                const failure = {
                  role,
                  sha,
                  surface: plan.surface,
                  entry: plan.entry,
                  scenario: plan.scenario,
                  viewport,
                  theme,
                };
                await writeFile(
                  path.join(output, `${name}.failure.json`),
                  `${JSON.stringify(failure, null, 2)}\n`,
                ).catch((diagnosticError) =>
                  console.error('Failure context unavailable:', diagnosticError),
                );
                await page
                  ?.screenshot({ path: path.join(output, `${name}.failure.png`), timeout: 5000 })
                  .catch((diagnosticError) =>
                    console.error('Failure screenshot unavailable:', diagnosticError),
                  );
                await context?.tracing
                  .stop({ path: path.join(output, `${name}.failure.trace.zip`) })
                  .catch((diagnosticError) =>
                    console.error('Failure trace unavailable:', diagnosticError),
                  );
                throw error;
              } finally {
                await context?.close();
                if (accountBoundary)
                  await new Promise((resolve) => accountBoundary.server.close(resolve));
                await rm(temporary, { recursive: true, force: true });
              }
            }
      } finally {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
    await verifyBuild(before, beforeSha, { extension });
    await verifyBuildArtifact(candidate, candidateSha, candidateTreeSha, { extension });
    if ((await trustedFixtureHash(before)) !== fixtureHash)
      throw new Error('Protected capture fixtures changed during execution');
    validateScreenshotManifest(manifest, { beforeSha, candidateSha });
    await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    await browser.close();
  }
}

if (
  process.argv[2] === '--record-build' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  recordBuild(process.argv[3], process.argv[4]).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    if (
      ![
        '--before',
        '--candidate',
        '--before-sha',
        '--candidate-sha',
        '--candidate-tree-sha',
        '--output',
        '--source-run-id',
        '--source-run-attempt',
        '--capture-run-id',
        '--capture-run-attempt',
        '--source-artifact-id',
        '--intent-file',
      ].includes(name) ||
      !process.argv[index + 1]
    )
      throw new Error('Invalid capture arguments');
    options[name.slice(2).replace(cliName, (_, letter) => letter.toUpperCase())] =
      process.argv[index + 1];
  }
  captureUI(options).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
