import assert from 'node:assert/strict';

import { capturePlanHash, validateCapturePlans } from './capture-ui.mjs';
import { boundedJSON, digest, hashPattern, safePath, shaPattern } from './common.mjs';
import { publishGitHubAttachments } from './github-attachments.mjs';
import {
  updateUiEvidence,
  validateScreenshotManifest,
  verifyTrustedCapture,
} from './screenshot-manifest.mjs';

const directory = 'reports/autonomy/screenshots';
export function verifyUiBuildReceipts(manifest, { readArtifact, headSha, baseSha, sourceTrees }) {
  const verified = {};
  for (const [role, sha] of [
    ['before', baseSha],
    ['candidate', headSha],
  ]) {
    const reference = manifest.builds?.[role];
    assert.ok(shaPattern.test(sourceTrees?.[role] ?? ''), 'Authenticated build tree required');
    assert.equal(reference?.path, `${role}-build.json`, 'Build receipt reference missing');
    const bytes = readArtifact(`${directory}/${reference.path}`);
    assert.equal(digest(bytes), reference.contentHash, 'Build receipt hash mismatch');
    const receipt = boundedJSON(bytes.toString('utf8'));
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(reference.sha, sha, 'Build reference revision mismatch');
    assert.equal(receipt.sha, sha, 'Build receipt revision mismatch');
    assert.equal(reference.treeSha, sourceTrees[role], 'Build reference tree mismatch');
    assert.equal(receipt.treeSha, sourceTrees[role], 'Build receipt tree mismatch');
    assert.ok(
      Array.isArray(receipt.files) && receipt.files.length > 0 && receipt.files.length <= 10000,
      'Build inventory missing or oversized',
    );
    const seen = new Set();
    for (const file of receipt.files) {
      safePath(file.path);
      assert.ok(!seen.has(file.path), 'Duplicate build inventory path');
      seen.add(file.path);
      assert.ok(hashPattern.test(file.contentHash ?? ''), 'Invalid build content hash');
    }
    assert.ok(seen.has('index.html'), 'Build index missing');
    verified[role] = {
      sha,
      treeSha: receipt.treeSha,
      contentHash: reference.contentHash,
      inventoryHash: digest(receipt.files),
    };
  }
  return verified;
}

export async function validateUiEvidence({
  readArtifact,
  github,
  pr,
  headSha,
  baseSha,
  policy,
  env,
  requiredSurfaces,
  runUrl,
  sourceTrees,
  trustedCapture,
  capturePlans,
  changedPaths,
  requiredPaths,
  fetchImpl = fetch,
  runCommand,
}) {
  const manifest = boundedJSON(readArtifact(`${directory}/manifest.json`).toString('utf8'));
  const plans = validateCapturePlans(capturePlans, {
    requiredSurfaces,
    changedPaths,
    requiredPaths,
  });
  const expectedPlanHash = capturePlanHash(plans);
  assert.equal(manifest.planHash, expectedPlanHash, 'Capture plan differs from current PR intent');
  assert.equal(capturePlanHash(manifest.plans), expectedPlanHash, 'Captured plan data mismatch');
  const matchesPlan = (capture, plan) => {
    const expected = capture.role === 'before' && plan.before ? { ...plan, ...plan.before } : plan;
    return (
      capture.surface === expected.surface &&
      capture.entry === expected.entry &&
      capture.route === expected.route &&
      capture.scenario === expected.scenario &&
      capture.state === expected.state
    );
  };
  for (const capture of manifest.captures ?? [])
    assert.ok(
      plans.some((plan) => matchesPlan(capture, plan)),
      'Unrelated generic screenshot cannot satisfy declared UI plan',
    );
  for (const plan of plans)
    for (const role of ['before', 'candidate'])
      for (const viewport of policy.screenshot.viewports)
        for (const theme of policy.screenshot.themes) {
          assert.ok(
            manifest.captures.some(
              (capture) =>
                matchesPlan(capture, plan) &&
                capture.role === role &&
                capture.viewport.width === viewport.width &&
                capture.viewport.height === viewport.height &&
                capture.theme === theme,
            ),
            'Declared scenario capture matrix incomplete',
          );
        }
  verifyTrustedCapture(manifest, trustedCapture);
  assert.equal(trustedCapture.controllerSha, baseSha, 'Capture controller is not protected base');
  assert.equal(
    trustedCapture.candidateTreeSha,
    sourceTrees?.candidate,
    'Capture candidate tree mismatch',
  );
  assert.equal(trustedCapture.baseTreeSha, sourceTrees?.before, 'Capture base tree mismatch');
  assert.ok(
    Array.isArray(requiredSurfaces) && requiredSurfaces.length > 0,
    'Declared screenshot surfaces required',
  );
  assert.equal(typeof runUrl, 'string', 'Authenticated workflow run URL required');
  validateScreenshotManifest(manifest, {
    beforeSha: baseSha,
    candidateSha: headSha,
    requiredSurfaces,
  });
  const builds = verifyUiBuildReceipts(manifest, { readArtifact, headSha, baseSha, sourceTrees });
  if (plans.some((plan) => plan.surface === 'extension'))
    for (const role of ['before', 'candidate']) {
      const receipt = boundedJSON(readArtifact(`${directory}/${role}-build.json`).toString('utf8'));
      assert.ok(
        Array.isArray(receipt.extensionFiles) &&
          receipt.extensionFiles.length > 0 &&
          receipt.extensionFiles.length <= 10000,
        'Installed extension build inventory required',
      );
      const entries = new Set();
      for (const file of receipt.extensionFiles) {
        safePath(file.path);
        assert.ok(!entries.has(file.path), 'Duplicate installed extension file');
        entries.add(file.path);
        assert.ok(hashPattern.test(file.contentHash ?? ''), 'Invalid installed extension hash');
      }
      assert.ok(entries.has('manifest.json'), 'Installed extension manifest missing');
      for (const plan of plans.filter((plan) => plan.surface === 'extension'))
        assert.ok(entries.has(`${plan.entry}.html`), 'Declared installed extension entry missing');
      builds[role].extensionInventoryHash = digest(receipt.extensionFiles);
    }
  const publishedAssets = await publishGitHubAttachments({
    captures: manifest.captures,
    readArtifact: (path) => readArtifact(`${directory}/${path}`),
    github,
    pr,
    headSha,
    baseSha,
    policy,
    token: env.AUTONOMY_IMAGE_TOKEN,
    fetchImpl,
    runCommand,
  });
  for (const capture of manifest.captures)
    capture.url = publishedAssets.find((asset) => asset.path === capture.path).url;
  const options = {
    headSha,
    baseSha,
    requiredSurfaces,
    runUrl,
    policy,
    impact: { ui: true },
    publishedAssets,
    readArtifact: (path) => readArtifact(`${directory}/${path}`),
  };
  const update = updateUiEvidence(pr.body ?? '', manifest, options);
  const fresh = await github.api(`/pulls/${pr.number}`);
  assert.equal(fresh.head.sha, pr.head.sha, 'Head changed during screenshot publication');
  assert.equal(fresh.base.sha, baseSha, 'Base changed during screenshot publication');
  assert.equal(
    fresh.body,
    pr.body,
    'PR body changed concurrently; retry without overwriting author content',
  );
  if (update.changed)
    await github.api(`/pulls/${pr.number}`, { method: 'PATCH', body: { body: update.body } });
  pr.body = update.body;
  validateScreenshotManifest(manifest, { ...options, body: pr.body });
  return {
    applicable: true,
    manifest,
    publishedAssets,
    builds,
    trustedCapture,
    capturePlans: plans,
    planHash: expectedPlanHash,
  };
}

export function markUiStale(body, currentSha) {
  const start = '<!-- autonomous-ui-evidence:start -->';
  const end = '<!-- autonomous-ui-evidence:end -->';
  const begin = body.indexOf(start);
  const finish = body.indexOf(end);
  if (begin < 0 && finish < 0) return body;
  assert.ok(
    begin >= 0 &&
      finish > begin &&
      !body.includes(start, begin + start.length) &&
      !body.includes(end, finish + end.length),
    'Ambiguous evidence markers',
  );
  return `${body.slice(0, begin)}${start}\nEvidence is stale for candidate \`${currentSha}\`. Awaiting a successful reproducible capture and trusted publication.\n${end}${body.slice(finish + end.length)}`;
}
