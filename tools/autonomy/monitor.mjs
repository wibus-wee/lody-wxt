import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { validateTag } from './release-plan.mjs';

const archiveIdentity = /^(?:[a-f0-9]{64}|unavailable)$/;
const recordedArchive = /^Archive SHA-256: ([a-f0-9]{64}|unavailable)$/m;
const workflowUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/;
export function monitorPolicy() {
  const policy = JSON.parse(
    readFileSync(new URL('../../.github/autonomous-maintenance-policy.yml', import.meta.url)),
  );
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.monitor.closeOnlyInstalledVerified, true);
  assert.ok(
    Number.isInteger(policy.monitor.retryLimit) &&
      policy.monitor.retryLimit >= 0 &&
      policy.monitor.retryLimit <= 5,
  );
  assert.ok(
    Number.isFinite(policy.monitor.cooldownHours) &&
      policy.monitor.cooldownHours >= 0 &&
      policy.monitor.cooldownHours <= 168,
  );
  return policy.monitor;
}
export function incidentPlan(
  issues,
  { tag, archiveSha256, success, now = Date.now(), cooldownHours = 24 },
) {
  assert.ok(Number.isFinite(now) && Number.isFinite(cooldownHours) && cooldownHours >= 0);
  validateTag(tag);
  assert.match(archiveSha256, archiveIdentity);
  // Per-tag identity stays stable even when the checksum download itself is broken.
  const marker = `<!-- lody-release-monitor:${tag} -->`;
  const matching = issues.filter((issue) => issue.body?.startsWith(`${marker}\n`));
  const open = matching.filter((issue) => issue.state.toLowerCase() === 'open');
  if (success) {
    assert.notEqual(archiveSha256, 'unavailable', 'Closure requires verified archive identity');
    for (const issue of open) {
      const recorded = recordedArchive.exec(issue.body)?.[1];
      assert.ok(
        recorded && (recorded === 'unavailable' || recorded === archiveSha256),
        'Incident archive identity changed; refusing closure',
      );
    }
    return { marker, create: false, reopen: [], close: open.map((issue) => issue.number) };
  }
  const recent = matching
    .filter(
      (issue) =>
        issue.state.toLowerCase() === 'closed' &&
        Number.isFinite(Date.parse(issue.closed_at)) &&
        now >= Date.parse(issue.closed_at) &&
        now - Date.parse(issue.closed_at) < cooldownHours * 3600000,
    )
    .sort((a, b) => Date.parse(b.closed_at) - Date.parse(a.closed_at));
  return {
    marker,
    create: open.length === 0 && recent.length === 0,
    reopen: open.length === 0 && recent.length ? [recent[0].number] : [],
    close: [],
  };
}
const gh = (...args) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120000,
  }).trim();
export function selectPublishedRelease(command = gh) {
  let release;
  try {
    release = JSON.parse(command('api', 'repos/{owner}/{repo}/releases/latest'));
  } catch (error) {
    let response;
    try {
      response = JSON.parse(String(error.stdout));
    } catch {
      throw error;
    }
    if (String(response.status) !== '404') throw error;
    // A 404 alone can also mean inaccessible data. Confirm a readable collection.
    const pages = JSON.parse(
      command('api', '--paginate', '--slurp', 'repos/{owner}/{repo}/releases?per_page=100'),
    );
    assert.ok(Array.isArray(pages) && pages.every(Array.isArray));
    const releases = pages.flat();
    assert.ok(
      releases.every(
        (item) => item && typeof item.draft === 'boolean' && typeof item.prerelease === 'boolean',
      ),
      'Invalid releases collection',
    );
    assert.ok(
      releases.every((item) => item.draft || item.prerelease),
      'Latest stable lookup failed despite an existing stable release',
    );
    return null;
  }
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, false);
  validateTag(release.tag_name);
  return release;
}
export function verifiedResult(file, expected) {
  const result = JSON.parse(readFileSync(file));
  assert.equal(result.version, validateTag(expected.tag));
  assert.equal(result.archiveSha256, expected.archiveSha256);
  for (const key of [
    'sameDirectoryBrowserRestart',
    'preferencesRetained',
    'settingsAndSidepanelLoaded',
    'introductionNavigation',
  ])
    assert.equal(result[key], true);
  assert.equal(result.axeViolations, 0);
  assert.ok(result.extensionId && result.browser);
  return result;
}
export function report({ tag, archiveSha256, success, runUrl }, command = gh) {
  assert.match(runUrl, workflowUrl);
  const issues = JSON.parse(
    command('api', '--paginate', '--slurp', 'repos/{owner}/{repo}/issues?state=all&per_page=100'),
  )
    .flat()
    .filter(
      (issue) =>
        !issue.pull_request &&
        issue.user?.login === 'github-actions[bot]' &&
        issue.user?.type === 'Bot',
    );
  const policy = monitorPolicy();
  const plan = incidentPlan(issues, {
    tag,
    archiveSha256,
    success,
    cooldownHours: policy.cooldownHours,
  });
  const previous = issues.find((issue) => plan.reopen.includes(issue.number));
  const retained = previous && recordedArchive.exec(previous.body)?.[1];
  const incidentArchive = retained && retained !== 'unavailable' ? retained : archiveSha256;
  const body = `${plan.marker}\n\nReleased installed-artifact monitor failed for ${tag}.\n\nArchive SHA-256: ${incidentArchive}\nObserved SHA-256: ${archiveSha256}\nEvidence and logs: ${runUrl}\n\nClosure requires a successful checksum/provenance check and installed-browser verification of this same release. No source rebuild substitutes for the released download.\n`;
  if (!success && archiveSha256 !== 'unavailable') {
    for (const issue of issues.filter(
      (item) => item.state.toLowerCase() === 'open' && item.body?.startsWith(plan.marker),
    )) {
      const recorded = recordedArchive.exec(issue.body)?.[1];
      if (recorded === 'unavailable')
        command(
          'api',
          '--method',
          'PATCH',
          `repos/{owner}/{repo}/issues/${issue.number}`,
          '-f',
          `body=${body}`,
        );
    }
  }
  if (plan.create)
    command(
      'api',
      'repos/{owner}/{repo}/issues',
      '-f',
      `title=Release monitor: ${tag}`,
      '-f',
      `body=${body}`,
    );
  for (const number of plan.reopen) {
    command(
      'api',
      '--method',
      'PATCH',
      `repos/{owner}/{repo}/issues/${number}`,
      '-f',
      'state=open',
      '-f',
      `body=${body}`,
    );
  }
  for (const number of plan.close) {
    command(
      'api',
      `repos/{owner}/{repo}/issues/${number}/comments`,
      '-f',
      `body=Verified recovery for ${tag}; installed archive SHA-256 ${archiveSha256}. Evidence: ${runUrl}`,
    );
    command(
      'api',
      '--method',
      'PATCH',
      `repos/{owner}/{repo}/issues/${number}`,
      '-f',
      'state=closed',
      '-f',
      'state_reason=completed',
    );
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command] = process.argv.slice(2);
  if (command === 'select') {
    const policy = monitorPolicy();
    const release = selectPublishedRelease();
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `tag=${release?.tag_name ?? ''}\ndownload_attempts=${policy.retryLimit + 1}\n`,
      { flag: 'a' },
    );
    if (!release) {
      const message =
        'No stable release has been published; installed-release verification was not run.\n';
      process.stdout.write(message);
      if (process.env.GITHUB_STEP_SUMMARY)
        writeFileSync(process.env.GITHUB_STEP_SUMMARY, message, { flag: 'a' });
    }
  } else if (command === 'result') {
    verifiedResult(process.env.RESULT_FILE, {
      tag: process.env.RELEASE_TAG,
      archiveSha256: process.env.ARCHIVE_SHA256,
    });
  } else if (command === 'report') {
    report({
      tag: process.env.RELEASE_TAG,
      archiveSha256: process.env.ARCHIVE_SHA256 || 'unavailable',
      success: process.env.MONITOR_SUCCESS === 'true',
      runUrl: process.env.RUN_URL,
    });
  } else throw new Error('Usage: monitor.mjs select|result|report');
}
