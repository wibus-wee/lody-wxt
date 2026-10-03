import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const sourceExtension = /\.tsx?$/;

async function main() {
  // TypeScript 7 checks the upstream source under its own optional-prop contract,
  // then the app consumes declarations with exactOptionalPropertyTypes enabled.
  execFileSync('node_modules/.bin/tsc', ['-p', 'tools/ui/tsconfig.json'], { stdio: 'inherit' });
  const manifest = JSON.parse(await readFile('vendor/lody/packages/ui/package.json', 'utf8'));
  const paths = Object.fromEntries(
    Object.entries(manifest.exports).map(([name, source]) => [
      name === '.' ? '@lody/ui' : `@lody/ui/${name.slice(2)}`,
      [`./lody-ui/${source.replace('./src/', '').replace(sourceExtension, '.d.ts')}`],
    ]),
  );
  // Emitted declarations live outside the package, so their transitive types
  // must resolve from the UI workspace, not an undeclared root dependency.
  paths['@base-ui/react/*'] = ['../vendor/lody/packages/ui/node_modules/@base-ui/react/*'];
  await mkdir('.cache', { recursive: true });
  await writeFile(
    '.cache/ui-tsconfig.json',
    JSON.stringify({ compilerOptions: { paths } }, null, 2),
  );
}
void main();
