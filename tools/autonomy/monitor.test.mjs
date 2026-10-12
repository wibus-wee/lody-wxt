import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { incidentPlan, report, selectPublishedRelease, verifiedResult } from './monitor.mjs';

const identity = { tag: 'v1.2.3', archiveSha256: 'a'.repeat(64) };
const issue = {
  number: 7,
  user: { login: 'github-actions[bot]', type: 'Bot' },
  state: 'open',
  body: `<!-- lody-release-monitor:v1.2.3 -->\n\nArchive SHA-256: ${identity.archiveSha256}`,
};
test('persistent incident identity deduplicates checksum/download failures across retries', () => {
  assert.equal(incidentPlan([], { ...identity, success: false }).create, true);
  assert.equal(
    incidentPlan([issue], { ...identity, archiveSha256: 'unavailable', success: false }).create,
    false,
  );
  assert.deepEqual(incidentPlan([issue], { ...identity, success: false }).close, []);
  assert.equal(
    incidentPlan([{ ...issue, state: 'closed' }], { ...identity, success: false }).create,
    true,
  );
});
test('verified recovery closes only the affected released version', () => {
  const unrelated = { ...issue, number: 8, body: '<!-- lody-release-monitor:v1.2.4 -->' };
  assert.deepEqual(incidentPlan([issue, unrelated], { ...identity, success: true }).close, [7]);
  assert.throws(() =>
    incidentPlan([issue], { ...identity, archiveSha256: 'unavailable', success: true }),
  );
});
test('stale or incomplete browser evidence cannot close an incident', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'monitor-result-'));
  const file = path.join(directory, 'result.json');
  const result = {
    version: '1.2.3',
    archiveSha256: identity.archiveSha256,
    sameDirectoryBrowserRestart: true,
    preferencesRetained: true,
    settingsAndSidepanelLoaded: true,
    introductionNavigation: true,
    axeViolations: 0,
    extensionId: 'installed-id',
    browser: 'chromium',
  };
  try {
    writeFileSync(file, JSON.stringify(result));
    assert.equal(verifiedResult(file, identity).version, '1.2.3');
    for (const change of [
      { archiveSha256: 'b'.repeat(64) },
      { version: '1.2.2' },
      { preferencesRetained: false },
      { axeViolations: 1 },
      { browser: '' },
    ]) {
      writeFileSync(file, JSON.stringify({ ...result, ...change }));
      assert.throws(() => verifiedResult(file, identity));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('recovery refuses a changed immutable archive but can resolve a failed download', () => {
  assert.throws(
    () => incidentPlan([issue], { ...identity, archiveSha256: 'b'.repeat(64), success: true }),
    /identity changed/,
  );
  const missing = { ...issue, body: issue.body.replace(identity.archiveSha256, 'unavailable') };
  assert.deepEqual(incidentPlan([missing], { ...identity, success: true }).close, [7]);
});
test('a lost issue-create response does not duplicate the incident on rerun', () => {
  const stored = [];
  let creates = 0;
  const command = (...args) => {
    if (args.includes('--paginate')) return JSON.stringify([stored]);
    if (args.includes(`title=Release monitor: ${identity.tag}`)) {
      creates += 1;
      stored.push({
        number: 9,
        user: { login: 'github-actions[bot]', type: 'Bot' },
        state: 'open',
        body: args.find((arg) => arg.startsWith('body=')).slice(5),
      });
      throw new Error('Response lost after issue creation');
    }
    throw new Error('Unexpected mutation');
  };
  const failure = {
    ...identity,
    success: false,
    runUrl: 'https://github.com/wibus-wee/lody-wxt/actions/runs/123',
  };
  assert.throws(() => report(failure, command), /Response lost/);
  report(failure, command);
  assert.equal(creates, 1);
});

test('a lost close response does not duplicate recovery comments after closure', () => {
  const stored = { ...issue };
  let comments = 0;
  const command = (...args) => {
    if (args.includes('--paginate')) return JSON.stringify([[stored]]);
    if (args.some((arg) => arg.endsWith('/comments'))) {
      comments += 1;
      return '';
    }
    if (args.includes('state=closed')) {
      stored.state = 'closed';
      throw new Error('Close response lost');
    }
    throw new Error('Unexpected mutation');
  };
  const recovery = {
    ...identity,
    success: true,
    runUrl: 'https://github.com/wibus-wee/lody-wxt/actions/runs/123',
  };
  assert.throws(() => report(recovery, command), /Close response lost/);
  report(recovery, command);
  assert.equal(comments, 1);
});

test('a recurrence within policy cooldown reopens the existing incident', () => {
  const now = Date.parse('2026-01-02T12:00:00Z');
  const closed = { ...issue, state: 'closed', closed_at: '2026-01-02T11:00:00Z' };
  const recurrence = incidentPlan([closed], {
    ...identity,
    success: false,
    now,
    cooldownHours: 24,
  });
  assert.equal(recurrence.create, false);
  assert.deepEqual(recurrence.reopen, [7]);
  assert.equal(
    incidentPlan([closed], {
      ...identity,
      success: false,
      now: now + 25 * 3600000,
      cooldownHours: 24,
    }).create,
    true,
  );
});
test('spoofed issue markers from other authors cannot authorize closing their issues', () => {
  const calls = [];
  const command = (...args) => {
    calls.push(args);
    return JSON.stringify([[{ ...issue, user: { login: 'someone', type: 'User' } }]]);
  };
  report(
    {
      ...identity,
      success: true,
      runUrl: 'https://github.com/wibus-wee/lody-wxt/actions/runs/123',
    },
    command,
  );
  assert.equal(calls.length, 1);
});

test('cooldown reopening preserves the previously verified immutable archive identity', () => {
  const closed = { ...issue, state: 'closed', closed_at: new Date().toISOString() };
  let patch;
  const command = (...args) => {
    if (args.includes('--paginate')) return JSON.stringify([[closed]]);
    patch = args;
    return '';
  };
  report(
    {
      ...identity,
      archiveSha256: 'b'.repeat(64),
      success: false,
      runUrl: 'https://github.com/wibus-wee/lody-wxt/actions/runs/123',
    },
    command,
  );
  assert.ok(patch.includes('state=open'));
  assert.ok(
    patch
      .find((arg) => arg.startsWith('body='))
      .includes(`Archive SHA-256: ${identity.archiveSha256}`),
  );
});

test('missing latest release skips only after confirming no stable published release', () => {
  const missing = Object.assign(new Error('404'), { stdout: '{"status":"404"}' });
  for (const releases of [
    [],
    [{ draft: true, prerelease: false }],
    [{ draft: false, prerelease: true }],
  ]) {
    const calls = [];
    assert.equal(
      selectPublishedRelease((...args) => {
        calls.push(args);
        if (args.at(-1).endsWith('/latest')) throw missing;
        return JSON.stringify([releases]);
      }),
      null,
    );
    assert.equal(calls.length, 2);
  }
});

test('release selection preserves stable identity and fails closed on access and data failures', () => {
  const stable = { tag_name: 'v1.2.3', draft: false, prerelease: false };
  assert.deepEqual(
    selectPublishedRelease(() => JSON.stringify(stable)),
    stable,
  );
  for (const error of [
    new Error('network'),
    Object.assign(new Error('403'), { stdout: '{"status":"403"}' }),
  ]) {
    assert.throws(
      () =>
        selectPublishedRelease(() => {
          throw error;
        }),
      (actual) => actual === error,
    );
  }
  const missing = Object.assign(new Error('404'), { stdout: '{"status":404}' });
  for (const response of [JSON.stringify([[stable]]), '{}', 'invalid', JSON.stringify([[{}]])]) {
    assert.throws(() =>
      selectPublishedRelease((...args) => {
        if (args.at(-1).endsWith('/latest')) throw missing;
        return response;
      }),
    );
  }
  assert.throws(
    () =>
      selectPublishedRelease((...args) => {
        if (args.at(-1).endsWith('/latest')) throw missing;
        throw new Error('collection unavailable');
      }),
    /collection unavailable/,
  );
  for (const release of [
    { ...stable, draft: true },
    { ...stable, tag_name: '../invalid' },
  ])
    assert.throws(() => selectPublishedRelease(() => JSON.stringify(release)));
});
