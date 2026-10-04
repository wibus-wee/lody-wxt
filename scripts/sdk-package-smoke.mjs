import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const platformDependency = /^(?:react(?:-dom|-native)?|expo(?:-.*)?|@expo\/.*|@types\/chrome)$/;
const excludedArchivePath = /\/(?:test|tests|node_modules)\//;

const root = resolve(import.meta.dirname, '..');
const packageRoot = join(root, 'packages/lody-sdk');
const require = createRequire(join(root, 'package.json'));
const compilerPackage = require.resolve('@typescript/native/package.json');
const compilerManifest = JSON.parse(await readFile(compilerPackage, 'utf8'));
const compiler = resolve(dirname(compilerPackage), compilerManifest.bin.tsc);
assert.match(
  compilerManifest.version,
  /^7\./,
  'The package consumer must compile with TypeScript 7',
);
const temp = await mkdtemp(join(tmpdir(), 'lody-sdk-consumer-'));

async function findPackage(name, from) {
  const entry = execFileSync(
    process.execPath,
    [
      '--experimental-import-meta-resolve',
      '--input-type=module',
      '-e',
      `const [name, parent] = process.argv.slice(1);
       try { console.log(import.meta.resolve(name, parent)); }
       catch (error) {
         if (!['ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error;
         console.log(import.meta.resolve(name + '/package.json', parent));
       }`,
      name,
      pathToFileURL(join(from, 'package.json')).href,
    ],
    { encoding: 'utf8', env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } },
  ).trim();
  let directory = dirname(fileURLToPath(entry));
  while (directory !== dirname(directory)) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (manifest.name === name) return { directory, manifest };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    directory = dirname(directory);
  }
  throw new Error(`Cannot locate installed runtime dependency ${name}`);
}

const copied = new Map();
async function copyDependency(name, from) {
  assert.ok(
    !platformDependency.test(name),
    `Platform dependency is forbidden in the standalone SDK: ${name}`,
  );
  const { directory, manifest } = await findPackage(name, from);
  if (copied.has(name)) {
    assert.equal(copied.get(name), manifest.version, `Conflicting runtime versions for ${name}`);
    return;
  }
  copied.set(name, manifest.version);
  await cp(directory, join(temp, 'node_modules', name), {
    recursive: true,
    dereference: true,
    filter: (path) =>
      path === directory ||
      !path
        .slice(directory.length + 1)
        .split('/')
        .includes('node_modules'),
  });
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    await copyDependency(dependency, directory);
  }
  const requiredPeers = Object.keys(manifest.peerDependencies ?? {}).filter(
    (peer) => !manifest.peerDependenciesMeta?.[peer]?.optional,
  );
  for (const peer of requiredPeers) {
    await copyDependency(peer, directory);
  }
}

try {
  execFileSync('pnpm', ['--dir', packageRoot, 'pack', '--pack-destination', temp], {
    stdio: 'inherit',
  });
  const archives = (await readdir(temp)).filter((name) => name.endsWith('.tgz'));
  assert.equal(archives.length, 1);
  const archive = join(temp, archives[0]);
  const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(files.includes('package/dist/index.js'));
  assert.ok(files.includes('package/dist/index.d.ts'));
  assert.ok(!files.some((file) => excludedArchivePath.test(file)));
  const sdk = join(temp, 'node_modules/@lody-mobile/sdk');
  await mkdir(sdk, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', sdk]);
  const manifest = JSON.parse(await readFile(join(sdk, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@lody-mobile/sdk');
  assert.equal(manifest.exports['.'].types, './dist/index.d.ts');
  assert.equal(manifest.exports['.'].import, './dist/index.js');
  assert.ok(
    Object.keys(manifest.exports).every((name) =>
      ['.', './source', './loro', './loro/source', './rpc', './rpc/source'].includes(name),
    ),
  );
  assert.deepEqual(Object.keys(manifest.peerDependencies ?? {}), []);
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    await copyDependency(dependency, packageRoot);
  }
  await copyFile(join(root, 'tests/sdk-consumer/consumer.mjs'), join(temp, 'consumer.mjs'));
  await copyFile(join(root, 'tests/sdk-consumer/consumer.mts'), join(temp, 'consumer.mts'));
  await copyFile(join(root, 'tests/sdk-consumer/tsconfig.json'), join(temp, 'tsconfig.json'));
  execFileSync(process.execPath, [join(temp, 'consumer.mjs')], {
    cwd: temp,
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
  });
  console.log(`SDK consumer compiler: TypeScript ${compilerManifest.version} (@typescript/native)`);
  execFileSync(process.execPath, [compiler, '-p', join(temp, 'tsconfig.json')], {
    cwd: temp,
    stdio: 'inherit',
  });
  console.log(
    'SDK tarball: isolated JavaScript runtime, TypeScript 7 declarations and private path rejection passed.',
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
