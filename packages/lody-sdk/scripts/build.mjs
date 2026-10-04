import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = new URL('../', import.meta.url);
const args = process.argv.slice(2);
if (!args.includes('--noEmit'))
  rmSync(new URL('dist/', packageRoot), { recursive: true, force: true });
const require = createRequire(import.meta.url);
const compiler = fileURLToPath(
  new URL('./bin/tsc', pathToFileURL(require.resolve('@typescript/native/package.json'))),
);
execFileSync(process.execPath, [compiler, '-p', 'tsconfig.json', ...args], {
  cwd: fileURLToPath(packageRoot),
  stdio: 'inherit',
});
