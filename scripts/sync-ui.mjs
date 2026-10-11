import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = 'vendor/lody';
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

if (git(['config', '-f', '.gitmodules', `submodule.${source}.branch`]) !== 'main') {
  throw new Error('The Lody UI submodule must track main in .gitmodules.');
}

const initialized = !git(['submodule', 'status', '--', source]).startsWith('-');
if (initialized && git(['status', '--porcelain', '--untracked-files=all'], `${root}${source}`)) {
  throw new Error('Lody UI has local changes. Commit or stash them before running pnpm ui:update.');
}

if (process.env.LODY_UI_PINNED === '1') {
  if (!initialized) throw new Error('Pinned verification requires an initialized Lody submodule.');
  const expected = git(['rev-parse', `HEAD:${source}`]);
  const revision = git(['rev-parse', 'HEAD'], `${root}${source}`);
  if (revision !== expected)
    throw new Error('Pinned verification requires the exact recorded Lody gitlink.');
  console.info(`Lody UI: recorded main revision ${revision} (verification mode)`);
} else {
  execFileSync('git', ['submodule', 'update', '--init', '--remote', '--checkout', '--', source], {
    cwd: root,
    stdio: 'inherit',
  });
  const revision = git(['rev-parse', 'HEAD'], `${root}${source}`);
  const latest = git(['rev-parse', 'origin/main'], `${root}${source}`);
  if (revision !== latest) {
    throw new Error(
      'Lody UI is not at origin/main. Remove conflicting local submodule configuration.',
    );
  }
  console.info(`Lody UI: main@${revision} (${source}/packages/ui)`);
}
