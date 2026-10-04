import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const configPath = resolve(root, 'tools/ui/tsconfig.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const sourceRoot = resolve(dirname(configPath), config.compilerOptions.rootDir);
const outputRoot = resolve(dirname(configPath), config.compilerOptions.outDir);

rmSync(outputRoot, { recursive: true, force: true });
execFileSync('pnpm', ['exec', 'tsc', '-p', configPath], { cwd: root, stdio: 'inherit' });

for (const file of config.files) {
  const source = resolve(dirname(configPath), file);
  const output = resolve(outputRoot, relative(sourceRoot, source).replace(/\.tsx?$/, '.js'));
  const specifier = relative(dirname(output), source).split('\\').join('/');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `export * from ${JSON.stringify(specifier)};\n`);
}
process.stdout.write('Lody UI declarations and source entrypoints built in dist/lody-ui.\n');
