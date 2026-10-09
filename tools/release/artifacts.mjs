import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import updateConfig from '../../src/features/updates/config.json' with { type: 'json' };

const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const markdownLink = /\]\(([^)]+\.mdx(?:#[^)]*)?)\)/g;
const forbiddenFile = /(?:^|\/)(?:\.[^/]+|node_modules|src|tools)(?:\/|$)|\.(?:map|ts|tsx)$/;
const repository = 'https://github.com/wibus-wee/lody-wxt';
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();

export function validateVersion(version, tag) {
  assert.ok(
    stableVersion.test(version) && version.trim() === version,
    'Release version must be a stable major.minor.patch.',
  );
  assert.ok(
    version.split('.').every((part) => Number(part) <= 65535) && version !== '0.0.0',
    'Release version must fit Chrome manifest version limits.',
  );
  assert.equal(tag, `v${version}`, 'Release tag must match package.json version.');
}

export function validateManifest(manifest, version, files) {
  assert.equal(manifest.version, version, 'Packaged manifest version must match package.json.');
  assert.equal(manifest.manifest_version, 3, 'Chrome release must use Manifest V3.');
  assert.equal(manifest.name, 'Lody');
  const required = [
    'manifest.json',
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    manifest.options_ui?.page ?? manifest.options_page,
    'runeicons-LICENSE.txt',
  ];
  for (const file of required) {
    assert.ok(typeof file === 'string' && files.includes(file), `Missing runtime asset: ${file}`);
  }
  assert.ok(!files.some((file) => forbiddenFile.test(file)), 'Release contains development files.');
}

function installationGuide(root, version) {
  const source = readFileSync(path.join(root, 'docs/contents/tutorial/install.mdx'), 'utf8');
  return `# Lody ${version} — 安装与更新\n\n${source
    .replace(frontmatter, '')
    .trim()
    .replace(markdownLink, (_, href) => {
      const target = new URL(
        href,
        `${repository}/blob/v${version}/docs/contents/tutorial/install.mdx`,
      );
      return `](${target.href})`;
    })}\n`;
}

export function packageRelease(root) {
  const { name, version } = json(path.join(root, 'package.json'));
  validateVersion(version, `v${version}`);
  const archive = path.join(root, '.output', `${name}-${version}-chrome.zip`);
  const files = run('unzip', ['-Z1', archive], root).split('\n');
  assert.ok(
    files.every((file) => !path.isAbsolute(file) && !file.split('/').includes('..')),
    'Archive paths must remain inside the extension directory.',
  );
  const manifest = JSON.parse(run('unzip', ['-p', archive, 'manifest.json'], root));
  validateManifest(manifest, version, files);

  const output = path.join(root, 'dist/release');
  const staging = mkdtempSync(path.join(tmpdir(), 'lody-release-'));
  try {
    rmSync(output, { recursive: true, force: true });
    mkdirSync(output, { recursive: true });
    mkdirSync(path.join(staging, 'lody'));
    run('unzip', ['-q', archive, '-d', path.join(staging, 'lody')], root);
    const guide = installationGuide(root, version);
    writeFileSync(path.join(staging, 'INSTALL.md'), guide);
    writeFileSync(path.join(output, 'INSTALL.md'), guide);
    const provenance = {
      version,
      commit: run('git', ['rev-parse', 'HEAD'], root),
      sourceTreeDirty:
        run('git', ['status', '--porcelain', '--ignore-submodules=all'], root) !== '',
      lodyUiCommit: run('git', ['-C', 'vendor/lody', 'rev-parse', 'HEAD'], root),
      runeiconsCommit: run('git', ['-C', 'vendor/runeicons', 'rev-parse', 'HEAD'], root),
      lockfileSha256: createHash('sha256')
        .update(readFileSync(path.join(root, 'pnpm-lock.yaml')))
        .digest('hex'),
    };
    writeFileSync(path.join(output, 'build-info.json'), `${JSON.stringify(provenance, null, 2)}\n`);
    cpSync(path.join(output, 'build-info.json'), path.join(staging, 'build-info.json'));
    run(
      'zip',
      [
        '-q',
        '-r',
        '-X',
        path.join(output, 'lody-chrome.zip'),
        'lody',
        'INSTALL.md',
        'build-info.json',
      ],
      staging,
    );
    const download = readFileSync(path.join(output, 'lody-chrome.zip'));
    const release = `${updateConfig.repository}/releases`;
    const appcast = {
      schemaVersion: updateConfig.schemaVersion,
      application: updateConfig.application,
      channel: updateConfig.channel,
      version,
      releaseNotesUrl: `${release}/tag/v${version}`,
      installationUrl: `${release}/download/v${version}/INSTALL.md`,
      enclosure: {
        url: `${release}/download/v${version}/lody-chrome.zip`,
        length: download.byteLength,
        sha256: createHash('sha256').update(download).digest('hex'),
        type: 'application/zip',
      },
    };
    writeFileSync(path.join(output, 'appcast.json'), `${JSON.stringify(appcast, null, 2)}\n`);
    const checksums = ['lody-chrome.zip', 'INSTALL.md', 'build-info.json', 'appcast.json'].map(
      (file) => {
        const digest = createHash('sha256')
          .update(readFileSync(path.join(output, file)))
          .digest('hex');
        return `${digest}  ${file}`;
      },
    );
    writeFileSync(path.join(output, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
    writeFileSync(
      path.join(output, 'release-notes.md'),
      `下载 **lody-chrome.zip**，解压后在 Chrome 中加载 **lody** 文件夹。普通使用不需要 Node、pnpm 或源码。\n\n` +
        `安装与手动更新步骤见附件 **INSTALL.md**；ZIP 中也包含同一份说明。更新时保留原加载目录和扩展 ID，覆盖程序文件后重新加载，避免卸载导致本地草稿丢失。\n\n` +
        `本地解压安装不会自动更新。使用前需要 Lody 账户，以及同一工作区中有可用 Agent 的在线机器。\n\n` +
        `版本：${version}。构建与依赖来源见 **build-info.json**，文件校验值见 **SHA256SUMS**。\n`,
    );
    return output;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
