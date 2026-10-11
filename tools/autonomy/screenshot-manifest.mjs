import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { isGitHubAttachment } from './common.mjs';

export const contentHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const positiveIdentity = /^[1-9]\d*$/;
const sha = /^[a-f0-9]{40}$/;
const pngPath = /^[\w-]+\.png$/;
const inlineImage = /!\[[^\]\n]*\]\((https:\/\/[^\s)]+)\)/g;
const digest = /^[a-f0-9]{64}$/;
const key = (item) =>
  JSON.stringify([item.surface, item.entry, item.viewport, item.theme, item.scenario]);

export function validateScreenshotManifest(manifest, options = {}) {
  const { beforeSha = options.baseSha, candidateSha = options.headSha } = options;
  if (manifest?.schemaVersion !== 1 || !digest.test(manifest.fixtureHash ?? ''))
    throw new Error('Invalid screenshot manifest or fixture hash');
  if (
    !Array.isArray(manifest.captures) ||
    !manifest.captures.length ||
    manifest.captures.length > 128
  )
    throw new Error('Screenshot captures are required');
  const pairs = new Map();
  for (const item of manifest.captures) {
    if (
      !['before', 'candidate'].includes(item.role) ||
      (item.surface !== undefined &&
        !['web', 'extension', 'docs', 'storybook'].includes(item.surface)) ||
      !sha.test(item.sha ?? '') ||
      !digest.test(item.contentHash ?? '') ||
      !['light', 'dark'].includes(item.theme) ||
      !item.route?.startsWith('/#') ||
      !item.scenario ||
      !Number.isInteger(item.viewport?.width) ||
      item.viewport.width < 1 ||
      !Number.isInteger(item.viewport?.height) ||
      item.viewport.height < 1 ||
      !pngPath.test(item.path ?? '')
    )
      throw new Error('Invalid screenshot capture');
    const expected = item.role === 'before' ? beforeSha : candidateSha;
    if (expected && item.sha !== expected) throw new Error('Screenshot SHA mismatch');
    const pair = pairs.get(key(item)) ?? {};
    if (pair[item.role]) throw new Error('Duplicate screenshot capture');
    pair[item.role] = item;
    pairs.set(key(item), pair);
  }
  for (const pair of pairs.values()) {
    if (!pair.before || !pair.candidate) throw new Error('Missing before/candidate pair');
  }
  for (const role of ['before', 'candidate']) {
    if (
      new Set(manifest.captures.filter((item) => item.role === role).map((item) => item.sha))
        .size !== 1
    )
      throw new Error('Mixed revision screenshots');
  }
  if (options.requiredSurfaces !== undefined) {
    if (
      !Array.isArray(options.requiredSurfaces) ||
      options.requiredSurfaces.some((surface) => typeof surface !== 'string' || !surface)
    )
      throw new Error('Invalid required screenshot surfaces');
    for (const surface of options.requiredSurfaces) {
      if (
        !manifest.captures.some(
          (capture) => capture.role === 'candidate' && capture.surface === surface,
        )
      )
        throw new Error(`Required screenshot surface missing: ${surface}`);
    }
  }
  if ('headSha' in options || 'baseSha' in options) verifyUploadedAssets(manifest, options);
  return manifest;
}

export function validateInlineScreenshotEvidence(
  manifest,
  body,
  { allowedOrigins = [], requireContentAddressed = true, ...expected } = {},
) {
  validateScreenshotManifest(manifest, expected);
  if (!allowedOrigins.length) throw new Error('Trusted durable image origins must be configured');
  for (const item of manifest.captures) {
    let url;
    try {
      url = new URL(item.url);
    } catch {
      throw new Error('Published screenshot URL required');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !allowedOrigins.includes(url.origin) ||
      (requireContentAddressed && !url.pathname.includes(item.contentHash))
    )
      throw new Error('Screenshot URL must be durable, trusted and content addressed');
    const inline = Array.from(String(body).matchAll(inlineImage), (match) => match[1]);
    if (!inline.includes(item.url))
      throw new Error('Screenshot missing from inline PR body evidence');
  }
  return manifest;
}

const start = '<!-- autonomous-ui-evidence:start -->';
const end = '<!-- autonomous-ui-evidence:end -->';
const maxBodyBytes = 60000;
const maxImageBytes = 10000000;
function boundedBody(body) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > maxBodyBytes)
    throw new Error('PR body exceeds evidence size bound');
  return body;
}
function verifyUploadedAssets(manifest, options) {
  const { headSha, baseSha, body, policy, readArtifact, publishedAssets, impact } = options;
  if (!sha.test(headSha ?? '') || !sha.test(baseSha ?? ''))
    throw new Error('Trusted head/base SHA required');
  if (typeof impact?.ui !== 'boolean') throw new Error('Trusted UI impact required');
  const screenshot = policy?.screenshot;
  if (!screenshot?.allowedImageHosts?.length)
    throw new Error('External image host allowlist required');
  if (typeof readArtifact !== 'function' || !Array.isArray(publishedAssets))
    throw new Error('Trusted artifact reader and publication receipts required');
  boundedBody(body);
  for (const capture of manifest.captures) {
    const bytes = readArtifact(capture.path);
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.length === 0 ||
      bytes.length > maxImageBytes ||
      contentHash(bytes) !== capture.contentHash
    )
      throw new Error('Screenshot artifact bytes/hash mismatch');
    const receipt = publishedAssets.filter((asset) => asset.path === capture.path);
    if (
      receipt.length !== 1 ||
      receipt[0].url !== capture.url ||
      receipt[0].contentHash !== capture.contentHash
    )
      throw new Error('Screenshot URL does not match trusted uploaded asset');
    const url = new URL(capture.url);
    if (!isGitHubAttachment(url) || !screenshot.allowedImageHosts.includes(url.hostname))
      throw new Error('Screenshot must use a GitHub attachment, never a repository image');
  }
  const origins = screenshot.allowedImageHosts.map((host) => `https://${host}`);
  validateInlineScreenshotEvidence(manifest, body, {
    beforeSha: baseSha,
    candidateSha: headSha,
    allowedOrigins: origins,
    requireContentAddressed: false,
  });
  if (
    !Array.isArray(screenshot.themes) ||
    !screenshot.themes.length ||
    !Array.isArray(screenshot.viewports) ||
    !screenshot.viewports.length
  )
    throw new Error('Screenshot theme/viewport policy required');
  const scenarios = new Set(
    manifest.captures
      .filter((capture) => capture.role === 'candidate')
      .map((capture) =>
        JSON.stringify([
          capture.surface,
          capture.entry,
          capture.route,
          capture.scenario,
          capture.state,
        ]),
      ),
  );
  for (const scenario of scenarios)
    for (const theme of screenshot.themes)
      for (const viewport of screenshot.viewports) {
        if (
          !manifest.captures.some(
            (capture) =>
              capture.role === 'candidate' &&
              JSON.stringify([
                capture.surface,
                capture.entry,
                capture.route,
                capture.scenario,
                capture.state,
              ]) === scenario &&
              capture.theme === theme &&
              capture.viewport.width === viewport.width &&
              capture.viewport.height === viewport.height,
          )
        )
          throw new Error('Required screenshot theme/viewport missing');
      }
}

const unsafeLabel = /[[\]\n\r`<>]/g;
const runPath = /^\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+(?:\/attempts\/\d+)?$/;
const contextLabel = (value) => String(value).replace(unsafeLabel, ' ');
function runLink(runUrl) {
  if (runUrl === undefined) return '';
  const url = new URL(runUrl);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !runPath.test(url.pathname)
  )
    throw new Error('Invalid screenshot workflow run URL');
  return `Run: [GitHub Actions](${url.href})\n\n`;
}

// Pure string helpers: posting the body belongs to trusted orchestration.
export function renderBody(body, manifest, options) {
  boundedBody(body);
  if (!options?.headSha || !options?.baseSha) throw new Error('Trusted render validation required');
  validateScreenshotManifest(manifest, {
    beforeSha: options.baseSha,
    candidateSha: options.headSha,
    requiredSurfaces: options.requiredSurfaces,
  });
  const original = manifest.captures;
  const rendered = original
    .map(
      (capture) =>
        `![${capture.role} | surface: ${contextLabel(capture.surface ?? 'unspecified')} ${contextLabel(capture.entry ?? '')} | state: ${contextLabel(capture.state ?? 'unspecified')} | route: ${contextLabel(capture.route)} | scenario: ${contextLabel(capture.scenario)} | ${capture.theme} ${capture.viewport.width}x${capture.viewport.height} | SHA: ${capture.sha}](${capture.url})`,
    )
    .join('\n');
  const block = `${start}\n${runLink(options.runUrl)}${rendered}\n${end}`;
  const begin = body.indexOf(start);
  const finish = body.indexOf(end);
  let result;
  if (begin === -1 && finish === -1) result = `${body}${body ? '\n\n' : ''}${block}`;
  else {
    if (
      begin < 0 ||
      finish < begin ||
      body.includes(start, begin + start.length) ||
      body.includes(end, finish + end.length)
    )
      throw new Error('Ambiguous UI evidence markers');
    result = body.slice(0, begin) + block + body.slice(finish + end.length);
  }
  boundedBody(result);
  validateScreenshotManifest(manifest, { ...options, body: result });
  if (!options?.headSha || !options?.baseSha) throw new Error('Trusted render validation required');
  return result;
}
export function updateUiEvidence(body, manifest, options) {
  const updatedBody = renderBody(body, manifest, options);
  return { body: updatedBody, changed: updatedBody !== body };
}

// These expectations must come from authenticated capture/build runs and protected source,
// never from the candidate manifest or contributor-provided fixture hashes.
export function verifyTrustedCapture(manifest, expected) {
  if (
    !expected ||
    !digest.test(expected.fixtureHash ?? '') ||
    !sha.test(expected.controllerSha ?? '')
  )
    throw new Error('Independently recomputed protected capture fixture binding required');
  if (
    expected.planHash !== undefined &&
    (!digest.test(expected.planHash) || manifest.planHash !== expected.planHash)
  )
    throw new Error('Authenticated capture plan hash mismatch');
  if (manifest.fixtureHash !== expected.fixtureHash)
    throw new Error('Protected capture fixture hash mismatch');
  const actual = manifest.captureContext;
  if (!actual || actual.controllerSha !== expected.controllerSha)
    throw new Error('Protected capture controller revision mismatch');
  for (const field of [
    'sourceRunId',
    'sourceRunAttempt',
    'captureRunId',
    'captureRunAttempt',
    'sourceArtifactId',
  ]) {
    if (
      !positiveIdentity.test(String(expected[field] ?? '')) ||
      String(actual[field]) !== String(expected[field])
    )
      throw new Error(`Authenticated screenshot ${field} mismatch`);
  }
  if (String(expected.captureRunId) === String(expected.sourceRunId))
    throw new Error('Capture must execute independently of candidate build run');
  for (const field of ['candidateTreeSha', 'baseTreeSha']) {
    if (!sha.test(expected[field] ?? '') || actual[field] !== expected[field])
      throw new Error(`Authenticated screenshot ${field} mismatch`);
  }
  return manifest;
}
