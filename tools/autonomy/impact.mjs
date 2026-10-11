import assert from 'node:assert/strict';

import { affectedImporters } from './impact-graph.mjs';

const visual = /\.(?:tsx|jsx|mdx|css|svg|png|webp|woff2?)$/;
const docFile = /\.(?:md|txt)$/;
const captureDataFile = /^tests\/e2e\/captures\/[\w/-]+\.json$/;
const testFile = /^(?:tests\/|.*\.test\.)/;
const extensionEntries = ['popup', 'sidepanel', 'options'];
const webEntrypoint = 'web/main.tsx';
const extensionEntrypoints = extensionEntries.map((entry) => `src/entrypoints/${entry}/main.tsx`);
const uiEntrypoints = [webEntrypoint, ...extensionEntrypoints];
const evidenceDirectory = /(?:^|\/)(?:screenshots?|__screenshots__|__image_snapshots__)(?:\/|$)/i;
const evidenceOutput = /^(?:reports|test-results|playwright-report)\//;
const captureFile = /^tests\/e2e\/captures\//;
const planDocument = /\/(?:[\w-]+\.json|README\.md)$/;

// .gitignore prevents accidents; the trusted diff check also rejects force-added evidence.
export function assertNoCommittedScreenshots(files) {
  for (const file of files) {
    if (file.status === 'removed') continue;
    const path = file.filename ?? file;
    assert.ok(
      !evidenceDirectory.test(path) &&
        !evidenceOutput.test(path) &&
        (!captureFile.test(path) || planDocument.test(path)),
      'Screenshot evidence belongs in GitHub attachments and CI artifacts, never Git',
    );
  }
}

export function classifyImpact(files, policy, model, graph) {
  assert.ok(
    Array.isArray(files) && files.length > 0 && files.length <= 3000,
    'Missing or truncated diff',
  );
  assertNoCommittedScreenshots(files);
  const paths = [
    ...new Set(
      files.flatMap((file) => [file.filename ?? file, file.previous_filename].filter(Boolean)),
    ),
  ];
  const protectedFiles = paths.filter((file) =>
    policy.protectedPrefixes.some((prefix) => file.startsWith(prefix)),
  );
  const elevatedFiles = paths.filter((file) =>
    policy.elevatedPrefixes.some((prefix) => file.startsWith(prefix)),
  );
  const dependentPaths = affectedImporters(paths, graph);
  const owners = Object.entries(model.owners)
    .filter(([, owner]) => owner.source.some((source) => dependentPaths.has(source)))
    .map(([id]) => id);
  const affectedJourneys = model.journeys
    .filter((journey) => journey.chain.some((owner) => owners.includes(owner)))
    .flatMap((journey) => journey.cases.map((variant) => `${journey.id}/${variant.id}`));
  const runtimeFiles = paths.filter(
    (file) =>
      !testFile.test(file) &&
      !docFile.test(file) &&
      !policy.nonRuntimePrefixes.some((prefix) => file.startsWith(prefix)),
  );
  const runtime = runtimeFiles.length > 0;
  // Unknown src changes are visual until a trusted reviewer resolves impact. A declaration cannot opt out.
  const ui = runtimeFiles.some(
    (file) => visual.test(file) || file.startsWith('src/') || file.startsWith('web/'),
  );
  const reachedExtensionEntries = extensionEntries.filter((entry, index) =>
    dependentPaths.has(extensionEntrypoints[index]),
  );
  const uiScopeUnresolved =
    ui &&
    runtimeFiles.some((file) => {
      if (!file.startsWith('src/') && !file.startsWith('web/')) return false;
      const reachable = affectedImporters([file], graph);
      return !uiEntrypoints.some((entry) => reachable.has(entry));
    });
  const requiredUiSurfaces = ui
    ? [
        ...(dependentPaths.has(webEntrypoint) || uiScopeUnresolved ? ['web'] : []),
        ...(reachedExtensionEntries.length || uiScopeUnresolved ? ['extension'] : []),
      ]
    : [];
  const requiredExtensionEntries = uiScopeUnresolved
    ? [...extensionEntries]
    : reachedExtensionEntries;
  const unknown =
    uiScopeUnresolved ||
    runtimeFiles.some(
      (file) =>
        !file.startsWith('src/') &&
        !file.startsWith('web/') &&
        !file.startsWith('packages/') &&
        !protectedFiles.includes(file),
    );
  return {
    paths,
    owners,
    affectedJourneys,
    runtime,
    ui,
    requiredUiSurfaces,
    requiredExtensionEntries,
    uiScopeUnresolved,
    unknown,
    testChanges: paths.some((file) => testFile.test(file) && !captureDataFile.test(file)),
    packagedExtension: runtime,
    risk: protectedFiles.length
      ? 'protected'
      : elevatedFiles.length || unknown
        ? 'elevated'
        : 'normal',
    protectedFiles,
    elevatedFiles,
    reason: uiScopeUnresolved
      ? 'UI entrypoint reachability unresolved; independent review required'
      : ui
        ? 'Rendered sources or potentially visible src behavior changed'
        : runtime
          ? 'Runtime change outside rendered sources'
          : 'Documentation or non-runtime artifacts only',
  };
}
