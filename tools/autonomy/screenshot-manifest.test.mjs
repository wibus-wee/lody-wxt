import assert from 'node:assert/strict';
// Node-only tooling runs independently of Vitest Browser Mode.
import test from 'node:test';

import {
  contentHash,
  validateInlineScreenshotEvidence,
  validateScreenshotManifest,
} from './screenshot-manifest.mjs';
const beforeSha = 'a'.repeat(40);
const candidateSha = 'b'.repeat(40);
const make = () => ({
  schemaVersion: 1,
  fixtureHash: contentHash('fixtures'),
  captures: ['before', 'candidate'].map((role) => ({
    role,
    surface: 'web',
    sha: role === 'before' ? beforeSha : candidateSha,
    route: '/#/account',
    viewport: { width: 360, height: 780 },
    theme: 'dark',
    scenario: 'account',
    path: `${role}.png`,
    contentHash: contentHash(role),
  })),
});
test('requires paired exact revision captures and hashes', () => {
  assert.ok(validateScreenshotManifest(make(), { beforeSha, candidateSha }));
  for (const mutate of [
    (m) => m.captures.pop(),
    (m) => {
      m.captures[0].sha = candidateSha;
    },
    (m) => {
      m.captures[0].contentHash = 'fake';
    },
    (m) => {
      m.captures[0].viewport.width = 400;
    },
    (m) => m.captures.push(m.captures[0]),
  ]) {
    const manifest = make();
    mutate(manifest);
    assert.throws(() => validateScreenshotManifest(manifest, { beforeSha, candidateSha }));
  }
});
test('requires trusted durable content addressed URLs inline in PR body', () => {
  const manifest = make();
  const options = { allowedOrigins: ['https://images.example.org'], beforeSha, candidateSha };
  assert.throws(() => validateInlineScreenshotEvidence(manifest, '', options));
  for (const item of manifest.captures)
    item.url = `https://images.example.org/${item.contentHash}.png`;
  const body = manifest.captures.map((item) => `![${item.role}](${item.url})`).join('\n');
  assert.ok(validateInlineScreenshotEvidence(manifest, body, options));
  assert.throws(() =>
    validateInlineScreenshotEvidence(manifest, body.replace('![before]', '[before]'), options),
  );
  assert.throws(() => validateInlineScreenshotEvidence(manifest, body));
  manifest.captures[0].url += '?expires=123';
  assert.throws(() => validateInlineScreenshotEvidence(manifest, body, options));
});

test('trusted validation binds image bytes, publication receipts and required matrix', async () => {
  const { renderBody, updateUiEvidence } = await import('./screenshot-manifest.mjs');
  const manifest = make();
  const publishedAssets = manifest.captures.map((capture) => {
    capture.url = `https://github.com/user-attachments/assets/${capture.role}`;
    return { path: capture.path, url: capture.url, contentHash: capture.contentHash };
  });
  const options = {
    headSha: candidateSha,
    baseSha: beforeSha,
    impact: { ui: true },
    requiredSurfaces: ['web'],
    runUrl: 'https://github.com/wibus-wee/lody-wxt/actions/runs/123',
    policy: {
      screenshot: {
        allowedImageHosts: ['github.com'],
        themes: ['dark'],
        viewports: [{ width: 360, height: 780 }],
      },
    },
    readArtifact: (file) => new TextEncoder().encode(file.replace('.png', '')),
    publishedAssets,
  };
  const body = renderBody('Author description', manifest, options);
  assert.ok(body.startsWith('Author description\n\n'));
  assert.ok(body.includes('<!-- autonomous-ui-evidence:start -->'));
  assert.ok(body.includes('<!-- autonomous-ui-evidence:end -->'));
  for (const context of [
    'surface: web',
    'route: /#/account',
    'scenario: account',
    `SHA: ${candidateSha}`,
    options.runUrl,
  ])
    assert.ok(body.includes(context));
  assert.throws(
    () =>
      renderBody('Description', manifest, { ...options, requiredSurfaces: ['web', 'extension'] }),
    /surface missing: extension/,
  );
  assert.throws(
    () =>
      renderBody('Description', manifest, { ...options, runUrl: 'https://example.com/run/123' }),
    /workflow run URL/,
  );
  assert.deepEqual(updateUiEvidence(body, manifest, options), { body, changed: false });
  assert.ok(validateScreenshotManifest(manifest, { ...options, body }));
  const repositoryImage = structuredClone(manifest);
  repositoryImage.captures[0].url =
    'https://github.com/wibus-wee/lody-wxt/blob/main/screenshots/before.png';
  const repositoryReceipts = repositoryImage.captures.map((capture) => ({
    path: capture.path,
    url: capture.url,
    contentHash: capture.contentHash,
  }));
  assert.throws(
    () =>
      renderBody('Description', repositoryImage, {
        ...options,
        publishedAssets: repositoryReceipts,
      }),
    /GitHub attachment, never a repository image/,
  );
  assert.throws(
    () =>
      validateScreenshotManifest(manifest, {
        ...options,
        body,
        readArtifact: () => new Uint8Array([1]),
      }),
    /bytes\/hash/,
  );
  assert.throws(
    () => validateScreenshotManifest(manifest, { ...options, body, publishedAssets: [] }),
    /uploaded asset/,
  );
  assert.throws(
    () => validateScreenshotManifest(manifest, { ...options, body: 'no inline images' }),
    /inline PR body/,
  );
  assert.throws(() => renderBody('x'.repeat(60001), manifest, options), /size bound/);
  assert.throws(
    () => renderBody('<!-- autonomous-ui-evidence:start -->broken', manifest, options),
    /Ambiguous/,
  );
  const missingMatrix = structuredClone(options.policy);
  missingMatrix.screenshot.themes.push('light');
  assert.throws(
    () => validateScreenshotManifest(manifest, { ...options, body, policy: missingMatrix }),
    /theme\/viewport/,
  );
});

test('trusted capture binding rejects contributor fixture hashes and original-run captures', async () => {
  const { verifyTrustedCapture } = await import('./screenshot-manifest.mjs');
  const expected = {
    fixtureHash: contentHash('independently read protected fixtures'),
    controllerSha: beforeSha,
    sourceRunId: '101',
    sourceRunAttempt: '2',
    captureRunId: '202',
    captureRunAttempt: '1',
    sourceArtifactId: '303',
    candidateTreeSha: 'c'.repeat(40),
    baseTreeSha: 'd'.repeat(40),
  };
  const manifest = make();
  manifest.fixtureHash = expected.fixtureHash;
  manifest.captureContext = { ...expected };
  assert.ok(verifyTrustedCapture(manifest, expected));
  assert.throws(() => verifyTrustedCapture(manifest), /Independently recomputed/);
  assert.throws(
    () =>
      verifyTrustedCapture(
        { ...manifest, fixtureHash: contentHash('contributor fixture') },
        expected,
      ),
    /fixture hash mismatch/,
  );
  assert.throws(
    () => verifyTrustedCapture(manifest, { ...expected, sourceRunAttempt: '3' }),
    /sourceRunAttempt mismatch/,
  );
  const reused = { ...expected, captureRunId: expected.sourceRunId };
  assert.throws(
    () => verifyTrustedCapture({ ...manifest, captureContext: reused }, reused),
    /independently/,
  );
  assert.throws(
    () => verifyTrustedCapture(manifest, { ...expected, controllerSha: candidateSha }),
    /controller revision/,
  );
});
