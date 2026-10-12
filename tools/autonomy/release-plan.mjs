import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { validateManifest } from '../release/artifacts.mjs';

const stableTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const checksumLine = /^([a-f0-9]{64}) {2}([\w.-]+)$/;
const gitSha = /^[a-f0-9]{40}$/;
const sha256Hex = /^[a-f0-9]{64}$/;
const repositoryName = /^[\w.-]+\/[\w.-]+$/;
const regexCharacters = /[.*+?^${}()|[\]\\]/g;
export const assets = [
  'INSTALL.md',
  'SHA256SUMS',
  'appcast.json',
  'build-info.json',
  'lody-chrome.zip',
];
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function validateTag(tag) {
  assert.match(tag, stableTag);
  assert.ok(
    tag !== 'v0.0.0' &&
      tag
        .slice(1)
        .split('.')
        .every((n) => Number(n) <= 65535),
  );
  return tag.slice(1);
}
// Inspect before the browser verifier extracts anything. zipfile checks CRCs and
// exposes Unix mode bits, unlike an entry-name-only unzip listing.
const inspectZip = `import hashlib,json,stat,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 entries=z.infolist()
 assert 0 < len(entries) <= 10000, 'Invalid ZIP inventory'
 assert sum(i.file_size for i in entries) <= 512*1024*1024, 'Oversized ZIP'
 seen=set()
 for i in entries:
  name=i.filename
  assert i.orig_filename == name and len(name.encode('utf-8')) <= 512, 'Invalid ZIP name'
  canonical=name[:-1] if i.is_dir() else name
  parts=canonical.split('/')
  assert not name.startswith('/') and all(p not in ('','.','..') for p in parts), 'Unsafe ZIP path'
  assert chr(92) not in name and ':' not in name and chr(0) not in name, 'Unsafe ZIP path'
  assert canonical.casefold() not in seen, 'Duplicate ZIP path'
  seen.add(canonical.casefold())
  assert name.startswith('lody/') or name in ('INSTALL.md','build-info.json'), 'Unexpected ZIP root'
  mode=stat.S_IFMT(i.external_attr >> 16)
  assert mode in (0,stat.S_IFREG,stat.S_IFDIR), 'Nonregular ZIP entry'
  assert mode != stat.S_IFDIR or i.is_dir(), 'Inconsistent ZIP directory'
  assert not i.is_dir() or mode in (0,stat.S_IFDIR), 'Inconsistent ZIP directory'
  assert not i.flag_bits & 1, 'Encrypted ZIP'
 assert z.testzip() is None, 'Corrupt ZIP'
 def metadata(name):
  assert z.getinfo(name).file_size <= 2*1024*1024, 'Oversized ZIP metadata'
  return z.read(name)
 print(json.dumps({'manifest':json.loads(metadata('lody/manifest.json')), 'files':[i.filename[5:] for i in entries if i.filename.startswith('lody/') and not i.is_dir()], 'infoHash':hashlib.sha256(metadata('build-info.json')).hexdigest(), 'guideHash':hashlib.sha256(metadata('INSTALL.md')).hexdigest()}))
`;
export function verifyArchive(directory, version) {
  const archive = path.join(directory, 'lody-chrome.zip');
  const inspected = JSON.parse(
    execFileSync('python3', ['-I', '-c', inspectZip, archive], {
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  validateManifest(inspected.manifest, version, inspected.files);
  assert.equal(
    inspected.infoHash,
    sha256(readFileSync(path.join(directory, 'build-info.json'))),
    'Embedded provenance differs',
  );
  assert.equal(
    inspected.guideHash,
    sha256(readFileSync(path.join(directory, 'INSTALL.md'))),
    'Embedded installation guide differs',
  );
}
export function verifyAssets(directory, tag, commit, provenance) {
  const version = validateTag(tag);
  for (const name of assets) {
    const file = lstatSync(path.join(directory, name));
    const limit =
      name === 'lody-chrome.zip'
        ? 256 * 1024 * 1024
        : name === 'SHA256SUMS'
          ? 4096
          : 2 * 1024 * 1024;
    assert.ok(
      file.isFile() && file.size > 0 && file.size <= limit,
      `Invalid or oversized release asset: ${name}`,
    );
  }
  const read = (name) => readFileSync(path.join(directory, name));
  const checksums = read('SHA256SUMS').toString().trim().split('\n');
  const expected = assets.filter((name) => name !== 'SHA256SUMS');
  assert.equal(checksums.length, expected.length);
  const seen = new Set();
  for (const line of checksums) {
    const match = checksumLine.exec(line);
    assert.ok(
      match && expected.includes(match[2]) && !seen.has(match[2]),
      'Invalid checksum inventory',
    );
    seen.add(match[2]);
    assert.equal(sha256(read(match[2])), match[1], `Checksum mismatch: ${match[2]}`);
  }
  const info = JSON.parse(read('build-info.json'));
  assert.equal(info.version, version);
  assert.equal(info.commit, commit);
  assert.equal(info.sourceTreeDirty, false, 'Release source must be clean');
  for (const field of ['lodyUiCommit', 'runeiconsCommit']) assert.match(info[field], gitSha);
  assert.match(info.lockfileSha256, sha256Hex);
  if (provenance) {
    for (const field of ['lodyUiCommit', 'runeiconsCommit', 'lockfileSha256'])
      assert.equal(info[field], provenance[field], `Tagged provenance mismatch: ${field}`);
  }
  const appcast = JSON.parse(read('appcast.json'));
  assert.equal(appcast.schemaVersion, 1);
  assert.equal(appcast.application, 'lody-wxt');
  assert.equal(appcast.channel, 'stable');
  assert.equal(appcast.version, version);
  assert.equal(appcast.enclosure.type, 'application/zip');
  const repository = `https://github.com/${process.env.GH_REPO || 'wibus-wee/lody-wxt'}`;
  assert.equal(appcast.releaseNotesUrl, `${repository}/releases/tag/${tag}`);
  assert.equal(appcast.installationUrl, `${repository}/releases/download/${tag}/INSTALL.md`);
  assert.equal(appcast.enclosure.sha256, sha256(read('lody-chrome.zip')));
  assert.equal(appcast.enclosure.length, read('lody-chrome.zip').length);
  assert.equal(
    appcast.enclosure.url,
    `https://github.com/${process.env.GH_REPO || 'wibus-wee/lody-wxt'}/releases/download/${tag}/lody-chrome.zip`,
  );
  verifyArchive(directory, version);
  return { version, commit, archiveSha256: appcast.enclosure.sha256 };
}
export function reconcileAssets(local, remote) {
  for (const name of Object.keys(remote)) {
    assert.ok(assets.includes(name), `Unexpected published asset: ${name}`);
    assert.equal(remote[name], local[name], `Immutable asset differs: ${name}`);
  }
  return assets.filter((name) => !(name in remote));
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
export function validateReleaseEnvironment(environment, name) {
  assert.ok(['release-promotion', 'release-publication'].includes(name));
  assert.equal(environment.name, name);
  assert.equal(
    environment.can_admins_bypass,
    false,
    'Release approval must not permit admin bypass',
  );
  const reviewers = environment.protection_rules?.find(
    (rule) => rule.type === 'required_reviewers',
  );
  assert.ok(!reviewers, 'Single-maintainer release must not require manual reviewers');
  assert.ok(
    environment.deployment_branch_policy,
    'Release environment must restrict deployment refs',
  );
  assert.ok(
    environment.deployment_branch_policy.protected_branches ||
      environment.deployment_branch_policy.custom_branch_policies,
    'Unrestricted release environment',
  );
  return name;
}
export function assertReleaseSource(tag, commit, main = 'refs/remotes/origin/main', workflowSha) {
  validateTag(tag);
  assert.match(commit, gitSha);
  assert.equal(
    git('rev-parse', `refs/tags/${tag}^{commit}`),
    commit,
    'Tag changed after package verification',
  );
  execFileSync('git', ['merge-base', '--is-ancestor', commit, main], { stdio: 'pipe' });
  if (workflowSha) {
    assert.match(workflowSha, gitSha);
    execFileSync('git', ['merge-base', '--is-ancestor', workflowSha, main], { stdio: 'pipe' });
  }
}
export function checkSource(tag) {
  const version = validateTag(tag);
  assert.equal(JSON.parse(readFileSync('package.json')).version, version);
  const commit = git('rev-parse', `refs/tags/${tag}^{commit}`);
  assert.equal(git('rev-parse', 'HEAD'), commit);
  assertReleaseSource(tag, commit);
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Tracked source changed');
  for (const name of ['lody', 'runeicons']) {
    const recorded = git('rev-parse', `HEAD:vendor/${name}`);
    assert.equal(
      git('-C', `vendor/${name}`, 'rev-parse', 'HEAD'),
      recorded,
      `${name} drifted from tag`,
    );
    assert.equal(git('-C', `vendor/${name}`, 'status', '--porcelain'), '');
  }
  return commit;
}
const gh = (...args) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120000,
  }).trim();
// Only successful reads establish absence. Authentication/network errors never mean "missing".
export function taggedProvenance(commit) {
  assert.match(commit, gitSha);
  return {
    lodyUiCommit: git('rev-parse', `${commit}:vendor/lody`),
    runeiconsCommit: git('rev-parse', `${commit}:vendor/runeicons`),
    lockfileSha256: sha256(execFileSync('git', ['show', `${commit}:pnpm-lock.yaml`])),
  };
}
export function verifyAttestations(directory, tag, options = {}, command = gh) {
  validateTag(tag);
  const repository = options.repository || process.env.GH_REPO || 'wibus-wee/lody-wxt';
  assert.match(repository, repositoryName);
  const escape = (value) => value.replace(regexCharacters, '\\$&');
  const identity = `^https://github[.]com/${escape(repository)}/[.]github/workflows/release[.]yml@(refs/heads/main|refs/tags/${escape(tag)})$`;
  const policy = [
    '--repo',
    repository,
    '--cert-identity-regex',
    identity,
    '--predicate-type',
    'https://slsa.dev/provenance/v1',
    '--deny-self-hosted-runners',
    '--format',
    'json',
  ];
  if (options.bundle) {
    assert.match(options.workflowSha, gitSha);
    assert.match(options.sourceSha, gitSha);
    assert.ok(
      ['refs/heads/main', `refs/tags/${tag}`].includes(options.sourceRef),
      'Untrusted attestation source ref',
    );
    policy.push(
      '--bundle',
      options.bundle,
      '--signer-digest',
      options.workflowSha,
      '--source-digest',
      options.sourceSha,
      '--source-ref',
      options.sourceRef,
    );
  }
  return assets.map((asset) => {
    const verification = JSON.parse(
      command('attestation', 'verify', path.join(directory, asset), ...policy),
    );
    assert.ok(
      Array.isArray(verification) && verification.length > 0,
      `No verified attestation: ${asset}`,
    );
    return { asset, verification };
  });
}
export function publish(tag, directory, commit, options = {}) {
  const command = options.command || gh;
  const provenance = options.provenance || taggedProvenance(commit);
  verifyAssets(directory, tag, commit, provenance);
  const releases = JSON.parse(
    command('api', '--paginate', '--slurp', 'repos/{owner}/{repo}/releases'),
  ).flat();
  let release = releases.find((item) => item.tag_name === tag);
  if (!release) {
    command(
      'release',
      'create',
      tag,
      '--draft',
      '--verify-tag',
      '--title',
      `Lody ${tag}`,
      '--notes-file',
      path.join(directory, 'release-notes.md'),
    );
    release = JSON.parse(command('release', 'view', tag, '--json', 'isDraft,assets'));
    release = { draft: release.isDraft, assets: release.assets };
  }
  const remoteDirectory = mkdtempSync(path.join(tmpdir(), 'lody-published-'));
  try {
    const local = Object.fromEntries(
      assets.map((name) => [name, sha256(readFileSync(path.join(directory, name)))]),
    );
    const remote = {};
    if (release.assets.length) {
      command('release', 'download', tag, '--dir', remoteDirectory);
      for (const name of readdirSync(remoteDirectory))
        remote[name] = sha256(readFileSync(path.join(remoteDirectory, name)));
    }
    const missing = reconcileAssets(local, remote);
    assert.ok(
      release.draft || missing.length === 0,
      'Published release has missing assets; refusing repair',
    );
    for (const name of missing) command('release', 'upload', tag, path.join(directory, name));
    // Re-download before publication, including after an interrupted prior upload.
    rmSync(remoteDirectory, { recursive: true, force: true });
    command('release', 'download', tag, '--dir', remoteDirectory);
    verifyAssets(remoteDirectory, tag, commit, provenance);
    reconcileAssets(
      local,
      Object.fromEntries(
        readdirSync(remoteDirectory).map((name) => [
          name,
          sha256(readFileSync(path.join(remoteDirectory, name))),
        ]),
      ),
    );
    if (release.draft) {
      // Releasing an older tag must not displace a newer stable download.
      const current = JSON.parse(
        command('api', '--paginate', '--slurp', 'repos/{owner}/{repo}/releases'),
      ).flat();
      const version = validateTag(tag).split('.').map(Number);
      const newerPublished = current.some((item) => {
        if (item.draft || item.prerelease || !stableTag.test(item.tag_name)) return false;
        const other = item.tag_name.slice(1).split('.').map(Number);
        const difference = other.findIndex((part, index) => part !== version[index]);
        return difference >= 0 && other[difference] > version[difference];
      });
      command('release', 'edit', tag, '--draft=false', `--latest=${!newerPublished}`);
    }
  } finally {
    rmSync(remoteDirectory, { recursive: true, force: true });
  }
}
export function planPromotion(source = 'HEAD') {
  if (source !== 'HEAD') assert.match(source, gitSha);
  const commit = git('rev-parse', `${source}^{commit}`);
  assert.equal(
    git('status', '--porcelain', '--untracked-files=no'),
    '',
    'Promotion source must be clean',
  );
  const manifestPath = '.release-please-manifest.json';
  const previousFiles = git('ls-tree', '--name-only', `${commit}^`, '--', manifestPath);
  if (!previousFiles) return null; // Bootstrap config is not a release.
  const previous = JSON.parse(git('show', `${commit}^:${manifestPath}`))['.'];
  const version = JSON.parse(git('show', `${commit}:${manifestPath}`))['.'];
  if (previous === version) return null;
  const tag = `v${version}`;
  validateTag(tag);
  validateTag(`v${previous}`);
  const before = previous.split('.').map(Number);
  const after = version.split('.').map(Number);
  const firstDifference = after.findIndex((part, index) => part !== before[index]);
  assert.ok(
    firstDifference >= 0 && after[firstDifference] > before[firstDifference],
    'Release version must increase',
  );
  assert.equal(JSON.parse(git('show', `${commit}:package.json`)).version, version);
  execFileSync('git', ['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main'], {
    stdio: 'pipe',
  });
  return { tag, commit };
}
export function promote(expectedCommit) {
  const plan = planPromotion(expectedCommit);
  assert.ok(plan, 'No merged release manifest change');
  const { tag, commit } = plan;
  assert.equal(commit, expectedCommit, 'Promotion plan changed');
  const refs = JSON.parse(
    gh('api', '--paginate', '--slurp', `repos/{owner}/{repo}/git/matching-refs/tags/${tag}`),
  ).flat();
  const existing = refs.find((ref) => ref.ref === `refs/tags/${tag}`);
  if (existing) {
    assert.equal(existing.object.type, 'commit');
    assert.equal(existing.object.sha, commit, 'Existing tag points elsewhere');
  } else {
    gh('api', 'repos/{owner}/{repo}/git/refs', '-f', `ref=refs/tags/${tag}`, '-f', `sha=${commit}`);
  }
  gh('workflow', 'run', 'release.yml', '--ref', 'main', '-f', `tag=${tag}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, tag, directory = 'dist/release', commit] = process.argv.slice(2);
  if (command === 'environment') {
    const environment = JSON.parse(gh('api', `repos/{owner}/{repo}/environments/${tag}`));
    validateReleaseEnvironment(environment, tag);
  } else if (command === 'plan') {
    const plan = planPromotion(tag);
    if (plan)
      writeFileSync(process.env.GITHUB_OUTPUT, `tag=${plan.tag}\ncommit=${plan.commit}\n`, {
        flag: 'a',
      });
  } else if (command === 'binding') {
    if (process.env.GITHUB_WORKFLOW_SHA)
      assert.ok(
        ['refs/heads/main', `refs/tags/${tag}`].includes(process.env.GITHUB_REF),
        'Untrusted workflow ref',
      );
    assertReleaseSource(tag, directory, undefined, process.env.GITHUB_WORKFLOW_SHA);
  } else if (command === 'promote') promote(tag);
  else if (command === 'source') process.stdout.write(`${checkSource(tag)}\n`);
  else if (command === 'verify')
    process.stdout.write(
      `${JSON.stringify(verifyAssets(directory, tag, commit, taggedProvenance(commit)))}\n`,
    );
  else if (command === 'attestations') {
    const options = commit
      ? {
          bundle: commit,
          workflowSha: process.env.GITHUB_WORKFLOW_SHA,
          sourceSha: process.env.GITHUB_SHA,
          sourceRef: process.env.GITHUB_REF,
        }
      : {};
    process.stdout.write(`${JSON.stringify(verifyAttestations(directory, tag, options))}\n`);
  } else if (command === 'publish') publish(tag, directory, commit);
  else
    throw new Error(
      'Usage: release-plan.mjs promote | environment ENVIRONMENT | binding TAG COMMIT | source TAG | attestations TAG DIRECTORY [BUNDLE] | verify|publish TAG DIRECTORY COMMIT',
    );
}
