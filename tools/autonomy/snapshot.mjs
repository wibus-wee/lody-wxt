import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

export function assertCleanSnapshot(directory = '.') {
  const git = (args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
  const changed = git([
    'diff',
    '--name-only',
    '-z',
    '--ignore-submodules=none',
    'HEAD',
    '--',
    '.',
    ':(exclude)COVERAGE.md',
  ])
    .split('\0')
    .filter(Boolean);
  assert.deepEqual(
    changed,
    [],
    'Candidate tracked source or submodule differs from claimed commit',
  );
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean);
  assert.deepEqual(untracked, [], 'Candidate contains untracked source not bound to its commit');
  return git(['rev-parse', 'HEAD']).trim();
}
