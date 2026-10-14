import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { packageRelease, validateManifest, validateVersion } from './artifacts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = {
  name: 'Lody',
  version: '0.1.0',
  manifest_version: 3,
  background: { service_worker: 'background.js' },
  side_panel: { default_path: 'sidepanel.html' },
  options_ui: { page: 'options.html' },
};
const files = [
  'manifest.json',
  'background.js',
  'sidepanel.html',
  'options.html',
  'runeicons-LICENSE.txt',
];

test('release tags are stable, exact and representable in Chrome', () => {
  validateVersion('0.1.0', 'v0.1.0');
  validateVersion('65535.65535.65535', 'v65535.65535.65535');
  for (const version of ['0.0.0', '01.0.0', '1.0.0-beta.1', '65536.0.0', '1.0', '1.0.0.1']) {
    assert.throws(() => validateVersion(version, `v${version}`));
  }
  for (const tag of ['v0.2.0', '0.1.0', 'main', undefined, 'v0.1.0\n']) {
    assert.throws(() => validateVersion('0.1.0', tag));
  }
});

test('packaged manifests must match the release and contain real runtime entries', () => {
  validateManifest(manifest, '0.1.0', files);
  assert.throws(() => validateManifest(manifest, '0.2.0', files));
  assert.throws(() => validateManifest({ ...manifest, manifest_version: 2 }, '0.1.0', files));
  for (const missing of files) {
    assert.throws(() =>
      validateManifest(
        manifest,
        '0.1.0',
        files.filter((file) => file !== missing),
      ),
    );
  }
  assert.throws(() => validateManifest({ ...manifest, background: {} }, '0.1.0', files));
  for (const developmentFile of [
    '.env',
    '.env.submit',
    'chunks/client.js.map',
    'src/client.ts',
    'tools/cli.mjs',
  ]) {
    assert.throws(() => validateManifest(manifest, '0.1.0', [...files, developmentFile]));
  }
});

test('download packaging preserves runtime bytes and produces matching offline docs and checksums', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'lody-release-test-'));
  const run = (command, args, cwd = fixture) =>
    execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
  try {
    const gitDirectory = run('git', ['rev-parse', '--absolute-git-dir'], root);
    for (const directory of ['', 'vendor/lody', 'vendor/runeicons']) {
      mkdirSync(path.join(fixture, directory), { recursive: true });
      writeFileSync(path.join(fixture, directory, '.git'), `gitdir: ${gitDirectory}\n`);
    }
    mkdirSync(path.join(fixture, '.output/chrome-mv3'), { recursive: true });
    mkdirSync(path.join(fixture, 'docs/contents/tutorial'), { recursive: true });
    writeFileSync(
      path.join(fixture, 'package.json'),
      JSON.stringify({ name: 'lody-wxt', version: '0.1.0' }),
    );
    writeFileSync(path.join(fixture, 'pnpm-lock.yaml'), 'fixture lockfile\n');
    writeFileSync(
      path.join(fixture, 'docs/contents/tutorial/install.mdx'),
      '---\ntitle: 安装与准备\n---\n\n离线说明。[继续](./first-conversation.mdx) [开发](../dev/getting-started.mdx#start)\n',
    );
    for (const file of files) {
      writeFileSync(
        path.join(fixture, '.output/chrome-mv3', file),
        file === 'manifest.json' ? JSON.stringify(manifest) : `runtime: ${file}\n`,
      );
    }
    run(
      'zip',
      ['-q', '-r', '../lody-wxt-0.1.0-chrome.zip', '.'],
      path.join(fixture, '.output/chrome-mv3'),
    );
    const output = packageRelease(fixture);
    const archive = path.join(output, 'lody-chrome.zip');
    const appcast = JSON.parse(readFileSync(path.join(output, 'appcast.json'), 'utf8'));
    const index = JSON.parse(readFileSync(path.join(output, 'update-index.json'), 'utf8'));
    assert.equal(index.version, '0.1.0');
    assert.equal(index.archive.sha256, appcast.enclosure.sha256);
    assert.equal(index.files.length, files.length);
    assert.equal(appcast.version, '0.1.0');
    assert.equal(appcast.enclosure.length, readFileSync(archive).byteLength);
    assert.equal(
      appcast.enclosure.sha256,
      createHash('sha256').update(readFileSync(archive)).digest('hex'),
    );
    assert.equal(
      appcast.enclosure.url,
      'https://github.com/wibus-wee/lody-wxt/releases/download/v0.1.0/lody-chrome.zip',
    );
    assert.equal(
      appcast.installationUrl,
      'https://github.com/wibus-wee/lody-wxt/releases/download/v0.1.0/INSTALL.md',
    );
    assert.equal(
      appcast.releaseNotesUrl,
      'https://github.com/wibus-wee/lody-wxt/releases/tag/v0.1.0',
    );
    const entries = run('unzip', ['-Z1', archive]).split('\n');
    assert.ok(entries.includes('lody/manifest.json'));
    assert.ok(entries.includes('INSTALL.md'));
    assert.ok(entries.includes('build-info.json'));
    assert.ok(!entries.includes('manifest.json'));
    for (const file of files) {
      assert.equal(
        run('unzip', ['-p', archive, `lody/${file}`]),
        readFileSync(path.join(fixture, '.output/chrome-mv3', file), 'utf8').trim(),
      );
    }
    const guide = readFileSync(path.join(output, 'INSTALL.md'), 'utf8');
    assert.ok(!guide.includes('title:'));
    assert.ok(guide.includes('/blob/v0.1.0/docs/contents/tutorial/first-conversation.mdx'));
    assert.ok(guide.includes('/blob/v0.1.0/docs/contents/dev/getting-started.mdx#start'));
    assert.equal(run('unzip', ['-p', archive, 'INSTALL.md']), guide.trim());
    for (const checksum of readFileSync(path.join(output, 'SHA256SUMS'), 'utf8')
      .trim()
      .split('\n')) {
      const [digest, file] = checksum.split('  ');
      assert.equal(
        digest,
        createHash('sha256')
          .update(readFileSync(path.join(output, file)))
          .digest('hex'),
      );
    }
    const provenance = JSON.parse(readFileSync(path.join(output, 'build-info.json'), 'utf8'));
    assert.equal(provenance.version, '0.1.0');
    assert.equal(provenance.commit, run('git', ['rev-parse', 'HEAD'], root));

    writeFileSync(path.join(output, 'stale.zip'), 'previous build');
    packageRelease(fixture);
    assert.throws(() => readFileSync(path.join(output, 'stale.zip')));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
