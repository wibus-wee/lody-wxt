import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';

import { createUpdateIndex } from '../release/update-index.mjs';
import {
  assertReleaseSource,
  assets,
  planPromotion,
  publish,
  reconcileAssets,
  releaseAssetNames,
  sha256,
  validateReleaseEnvironment,
  validateTag,
  verifyArchive,
  verifyAssets,
  verifyAttestations,
} from './release-plan.mjs';

test('stable Chrome tags reject ambiguous or invalid versions', () => {
  for (const tag of ['v01.2.3', 'v1.2.3-beta', 'v0.0.0', 'v65536.1.0', 'v1.2.3\n', '--help'])
    assert.throws(() => validateTag(tag));
  assert.equal(validateTag('v1.2.3'), '1.2.3');
});
test('resume missing draft assets without allowing replacement or unexpected inventory', () => {
  const local = Object.fromEntries(assets.map((name) => [name, name]));
  assert.deepEqual(
    reconcileAssets(local, { 'INSTALL.md': 'INSTALL.md' }),
    assets.filter((name) => name !== 'INSTALL.md'),
  );
  assert.deepEqual(reconcileAssets(local, local), []);
  assert.throws(() => reconcileAssets(local, { 'INSTALL.md': 'changed' }));
  assert.throws(() => reconcileAssets(local, { 'unknown.zip': 'digest' }));
});
test('checksum inventory, version, commit and tagged dependency provenance are enforced', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'release-plan-'));
  const commit = 'a'.repeat(40);
  const provenance = {
    lodyUiCommit: 'b'.repeat(40),
    runeiconsCommit: 'c'.repeat(40),
    lockfileSha256: 'd'.repeat(64),
  };
  const files = {
    'INSTALL.md': 'Install',
    'build-info.json': JSON.stringify({
      version: '1.2.3',
      commit,
      sourceTreeDirty: false,
      ...provenance,
    }),
  };
  const manifest = {
    name: 'Lody',
    version: '1.2.3',
    manifest_version: 3,
    background: { service_worker: 'background.js' },
    side_panel: { default_path: 'sidepanel.html' },
    options_ui: { page: 'options.html' },
  };
  const entries = {
    'lody/manifest.json': JSON.stringify(manifest),
    'lody/background.js': 'fixture',
    'lody/sidepanel.html': 'fixture',
    'lody/options.html': 'fixture',
    'lody/runeicons-LICENSE.txt': 'fixture',
    'INSTALL.md': files['INSTALL.md'],
    'build-info.json': files['build-info.json'],
  };
  const makeZip = (changes = {}) => {
    const output = path.join(directory, 'fixture.zip');
    execFileSync('python3', [
      '-c',
      'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1], "w") as z:\n for name,body in json.loads(sys.argv[2]).items(): z.writestr(name,body)',
      output,
      JSON.stringify({ ...entries, ...changes }),
    ]);
    return readFileSync(output);
  };
  files['lody-chrome.zip'] = makeZip();
  files['appcast.json'] = JSON.stringify({
    schemaVersion: 1,
    application: 'lody-wxt',
    channel: 'stable',
    releaseNotesUrl: `https://github.com/${process.env.GH_REPO || 'wibus-wee/lody-wxt'}/releases/tag/v1.2.3`,
    installationUrl: `https://github.com/${process.env.GH_REPO || 'wibus-wee/lody-wxt'}/releases/download/v1.2.3/INSTALL.md`,
    version: '1.2.3',
    enclosure: {
      type: 'application/zip',
      sha256: sha256(files['lody-chrome.zip']),
      length: files['lody-chrome.zip'].length,
      url: `https://github.com/${process.env.GH_REPO || 'wibus-wee/lody-wxt'}/releases/download/v1.2.3/lody-chrome.zip`,
    },
  });
  const save = () => {
    for (const [name, content] of Object.entries(files))
      writeFileSync(path.join(directory, name), content);
    writeFileSync(
      path.join(directory, 'SHA256SUMS'),
      `${Object.entries(files)
        .map(([name, content]) => `${sha256(content)}  ${name}`)
        .join('\n')}\n`,
    );
  };
  try {
    save();
    assert.equal(
      verifyAssets(directory, 'v1.2.3', commit, provenance).archiveSha256,
      sha256(files['lody-chrome.zip']),
    );
    assert.throws(() => verifyAssets(directory, 'v1.2.3', 'e'.repeat(40), provenance));
    assert.throws(() =>
      verifyAssets(directory, 'v1.2.3', commit, { ...provenance, lodyUiCommit: 'e'.repeat(40) }),
    );
    for (const changes of [
      { '../escape': 'bad' },
      { 'lody/../escape': 'bad' },
      { 'lody/source.ts': 'bad' },
      { 'build-info.json': '{}' },
      { 'INSTALL.md': 'altered' },
      { 'lody/manifest.json': JSON.stringify({ ...manifest, version: '9.9.9' }) },
    ]) {
      writeFileSync(path.join(directory, 'lody-chrome.zip'), makeZip(changes));
      assert.throws(() => verifyArchive(directory, '1.2.3'));
    }
    save();
    for (const script of [
      'import sys,zipfile,stat\nwith zipfile.ZipFile(sys.argv[1], "a") as z:\n i=zipfile.ZipInfo("lody/link"); i.create_system=3; i.external_attr=(stat.S_IFLNK|0o777)<<16; z.writestr(i,"../escape")',
      'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1], "a") as z: z.writestr("lody/manifest.json", "{}")',
    ]) {
      save();
      execFileSync('python3', ['-I', '-c', script, path.join(directory, 'lody-chrome.zip')], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.throws(() => verifyArchive(directory, '1.2.3'));
    }
    save();
    const archivePath = path.join(directory, 'lody-chrome.zip');
    truncateSync(archivePath, 256 * 1024 * 1024 + 1);
    assert.throws(() => verifyAssets(directory, 'v1.2.3', commit, provenance), /oversized/);
    save();
    unlinkSync(archivePath);
    symlinkSync(path.join(directory, 'fixture.zip'), archivePath);
    assert.throws(() => verifyAssets(directory, 'v1.2.3', commit, provenance), /Invalid/);
    unlinkSync(archivePath);
    save();
    // Model an upload accepted by GitHub whose response is lost. A rerun must
    // inspect stored bytes, upload only missing names, and publish exactly once.
    const remote = new Map();
    let draft = true;
    let uploads = 0;
    let edits = 0;
    let interrupted = false;
    const command = (...args) => {
      if (args[0] === 'api')
        return JSON.stringify([
          [{ tag_name: 'v1.2.3', draft, assets: Array.from(remote.keys(), (name) => ({ name })) }],
        ]);
      if (args[1] === 'download') {
        const destination = args[args.indexOf('--dir') + 1];
        mkdirSync(destination, { recursive: true });
        for (const [name, bytes] of remote) writeFileSync(path.join(destination, name), bytes);
      } else if (args[1] === 'upload') {
        const file = args[3];
        assert.ok(!remote.has(path.basename(file)), 'Never upload an existing name');
        remote.set(path.basename(file), readFileSync(file));
        uploads += 1;
        if (uploads === 2 && !interrupted) {
          interrupted = true;
          throw new Error('Response lost after accepted upload');
        }
      } else if (args[1] === 'edit') {
        draft = false;
        edits += 1;
      } else throw new Error(`Unexpected mutation: ${args.join(' ')}`);
      return '';
    };
    assert.throws(
      () => publish('v1.2.3', directory, commit, { command, provenance }),
      /Response lost/,
    );
    publish('v1.2.3', directory, commit, { command, provenance });
    publish('v1.2.3', directory, commit, { command, provenance });
    assert.equal(uploads, assets.length);
    assert.equal(edits, 1);
    remote.set('INSTALL.md', Buffer.from('changed published bytes'));
    assert.throws(
      () => publish('v1.2.3', directory, commit, { command, provenance }),
      /Immutable asset differs/,
    );
    assert.equal(uploads, assets.length);
    // New packages require a separately checksummed index bound to the real ZIP.
    files['build-info.json'] = JSON.stringify({
      ...JSON.parse(files['build-info.json']),
      updateIndexSchema: 1,
    });
    entries['build-info.json'] = files['build-info.json'];
    files['lody-chrome.zip'] = makeZip();
    const indexedAppcast = JSON.parse(files['appcast.json']);
    indexedAppcast.enclosure.sha256 = sha256(files['lody-chrome.zip']);
    indexedAppcast.enclosure.length = files['lody-chrome.zip'].length;
    files['appcast.json'] = JSON.stringify(indexedAppcast);
    save();
    assert.throws(() => verifyAssets(directory, 'v1.2.3', commit, provenance));
    files['update-index.json'] = JSON.stringify(
      createUpdateIndex(path.join(directory, 'lody-chrome.zip'), '1.2.3'),
    );
    save();
    verifyAssets(directory, 'v1.2.3', commit, provenance);
    const validIndex = files['update-index.json'];
    const corruptIndex = JSON.parse(validIndex);
    corruptIndex.files[0].sha256 = '0'.repeat(64);
    files['update-index.json'] = JSON.stringify(corruptIndex);
    save(); // Recompute checksum too: ZIP comparison must still reject it.
    assert.throws(
      () => verifyAssets(directory, 'v1.2.3', commit, provenance),
      /Update index differs/,
    );
    files['update-index.json'] = validIndex;
    save();
    writeFileSync(path.join(directory, 'lody-chrome.zip'), 'tampered');
    assert.throws(() => verifyAssets(directory, 'v1.2.3', commit, provenance));
    save();
    writeFileSync(path.join(directory, 'SHA256SUMS'), `${sha256('Install')}  ../INSTALL.md\n`);
    assert.throws(() => verifyAssets(directory, 'v1.2.3', commit, provenance));
    files['build-info.json'] = JSON.stringify({
      version: '1.2.3',
      commit,
      sourceTreeDirty: true,
      ...provenance,
    });
    save();
    assert.throws(() => verifyAssets(directory, 'v1.2.3', commit, provenance));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('single-maintainer environments keep ref restrictions without manual reviewers', () => {
  const environment = {
    name: 'release-publication',
    can_admins_bypass: false,
    deployment_branch_policy: { custom_branch_policies: true },
    protection_rules: [],
  };
  assert.equal(
    validateReleaseEnvironment(environment, 'release-publication'),
    'release-publication',
  );
  for (const change of [
    { can_admins_bypass: true },
    { deployment_branch_policy: null },
    { name: 'other' },
    {
      protection_rules: [
        { type: 'required_reviewers', prevent_self_review: false, reviewers: [{ id: 42 }] },
      ],
    },
  ])
    assert.throws(() =>
      validateReleaseEnvironment({ ...environment, ...change }, 'release-publication'),
    );
});

test('release planning and publication require the exact approved tag on main history', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'release-source-'));
  const original = process.cwd();
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const saveVersion = (version) => {
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version }));
    writeFileSync(
      path.join(directory, '.release-please-manifest.json'),
      JSON.stringify({ '.': version }),
    );
  };
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Release test',
      '-c',
      'user.email=release@example.invalid',
      'commit',
      '-m',
      'fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-b', 'main');
    saveVersion('0.1.0');
    commit();
    saveVersion('0.2.0');
    const approved = commit();
    git('update-ref', 'refs/remotes/origin/main', approved);
    git('tag', 'v0.2.0');
    process.chdir(directory);
    assert.deepEqual(planPromotion(), { tag: 'v0.2.0', commit: approved });
    assert.doesNotThrow(() => assertReleaseSource('v0.2.0', approved));
    assert.doesNotThrow(() => assertReleaseSource('v0.2.0', approved, undefined, approved));
    // A later workflow fix may resume the same approved release source, never a ref or off-main commit.
    writeFileSync(path.join(directory, 'maintenance.txt'), 'release workflow fix');
    const maintenance = commit();
    git('update-ref', 'refs/remotes/origin/main', maintenance);
    assert.equal(planPromotion(), null);
    assert.deepEqual(planPromotion(approved), { tag: 'v0.2.0', commit: approved });
    assert.throws(() => planPromotion('main'));
    saveVersion('0.3.0');
    assert.throws(() => planPromotion(), /clean/);
    commit();
    const offMain = git('rev-parse', 'HEAD');
    git('tag', 'v0.3.0');
    assert.throws(() => assertReleaseSource('v0.3.0', offMain));
    assert.throws(() => assertReleaseSource('v0.2.0', approved, undefined, offMain));
    assert.throws(() => assertReleaseSource('v0.2.0', offMain), /Tag changed/);
    assert.throws(() => planPromotion());
    git('update-ref', 'refs/remotes/origin/main', offMain);
    saveVersion('0.1.0');
    const downgrade = commit();
    git('update-ref', 'refs/remotes/origin/main', downgrade);
    assert.throws(() => planPromotion(), /must increase/);
  } finally {
    process.chdir(original);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('every public asset requires a verified provenance signature from the restricted release workflow', () => {
  const calls = [];
  const command = (...args) => {
    calls.push(args);
    return JSON.stringify([{ verificationResult: { verified: true } }]);
  };
  const result = verifyAttestations(
    'release-assets',
    'v1.2.3',
    { repository: 'example/lody.wxt' },
    command,
  );
  assert.deepEqual(
    result.map((item) => item.asset),
    assets,
  );
  assert.equal(calls.length, assets.length);
  for (const [index, args] of calls.entries()) {
    assert.deepEqual(args.slice(0, 3), [
      'attestation',
      'verify',
      path.join('release-assets', assets[index]),
    ]);
    assert.equal(args[args.indexOf('--repo') + 1], 'example/lody.wxt');
    // gh accepts exactly one identity selector; the anchored certificate regex pins the workflow.
    assert.deepEqual(
      args.filter((arg) =>
        ['--cert-identity', '--cert-identity-regex', '--signer-repo', '--signer-workflow'].includes(
          arg,
        ),
      ),
      ['--cert-identity-regex'],
    );
    assert.equal(args[args.indexOf('--predicate-type') + 1], 'https://slsa.dev/provenance/v1');
    assert.ok(args.includes('--deny-self-hosted-runners'));
    const identity = new RegExp(args[args.indexOf('--cert-identity-regex') + 1]);
    assert.ok(
      identity.test(
        'https://github.com/example/lody.wxt/.github/workflows/release.yml@refs/heads/main',
      ),
    );
    assert.ok(
      identity.test(
        'https://github.com/example/lody.wxt/.github/workflows/release.yml@refs/tags/v1.2.3',
      ),
    );
    assert.equal(
      identity.test(
        'https://github.com/example/lodyXwxt/.github/workflows/release.yml@refs/heads/main',
      ),
      false,
    );
    assert.equal(
      identity.test(
        'https://github.com/example/lody.wxt/.github/workflows/release.yml@refs/tags/v1.2.4',
      ),
      false,
    );
    assert.equal(
      identity.test(
        'https://github.com/example/lody.wxt/.github/workflows/release.yml@refs/heads/untrusted',
      ),
      false,
    );
  }
});
test('publisher verifies the returned bundle against exact workflow and source identity', () => {
  const options = {
    repository: 'example/product',
    bundle: '/trusted/attestation.jsonl',
    workflowSha: 'a'.repeat(40),
    sourceSha: 'b'.repeat(40),
    sourceRef: 'refs/heads/main',
  };
  const command = (...args) => {
    for (const [flag, value] of [
      ['--bundle', options.bundle],
      ['--signer-digest', options.workflowSha],
      ['--source-digest', options.sourceSha],
      ['--source-ref', options.sourceRef],
    ])
      assert.equal(args[args.indexOf(flag) + 1], value);
    return '[{}]';
  };
  assert.equal(
    verifyAttestations('release-assets', 'v1.2.3', options, command).length,
    assets.length,
  );
  for (const change of [
    { workflowSha: 'bad' },
    { sourceSha: 'bad' },
    { sourceRef: 'refs/heads/untrusted' },
  ])
    assert.throws(() =>
      verifyAttestations('release-assets', 'v1.2.3', { ...options, ...change }, command),
    );
});
test('missing or rejected attestations stop verification without skipping subjects', () => {
  assert.throws(
    () => verifyAttestations('release-assets', 'v1.2.3', {}, () => '[]'),
    /No verified attestation/,
  );
  let verified = 0;
  assert.throws(
    () =>
      verifyAttestations('release-assets', 'v1.2.3', {}, () => {
        verified += 1;
        throw new Error('Signature verification failed');
      }),
    /Signature verification failed/,
  );
  assert.equal(verified, 1);
});

test('legacy inventories remain unchanged; indexed releases require the extra signed asset', () => {
  assert.deepEqual(releaseAssetNames({}), assets);
  assert.deepEqual(releaseAssetNames({ updateIndexSchema: 1 }), [...assets, 'update-index.json']);
  assert.throws(() => releaseAssetNames({ updateIndexSchema: 2 }));
  const local = Object.fromEntries([...assets, 'update-index.json'].map((name) => [name, name]));
  const legacy = Object.fromEntries(assets.map((name) => [name, name]));
  assert.deepEqual(reconcileAssets(local, legacy), ['update-index.json']);
  assert.throws(() => reconcileAssets(legacy, local));
});
