import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { assertCleanSnapshot } from './snapshot.mjs';

test('commit provenance rejects staged, unstaged and untracked candidate code while allowing generated reports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lody-snapshot-test-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: directory, stdio: 'pipe', encoding: 'utf8' });
  try {
    git('init', '--quiet');
    await mkdir(join(directory, 'src'));
    await writeFile(join(directory, '.gitignore'), 'reports/\n');
    await writeFile(join(directory, 'src/app.ts'), 'export const value = 1;\n');
    await writeFile(join(directory, 'COVERAGE.md'), 'initial\n');
    git('add', '.');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    );
    const sha = git('rev-parse', 'HEAD').trim();
    assert.equal(assertCleanSnapshot(directory), sha);
    await writeFile(join(directory, 'COVERAGE.md'), 'real generated evidence\n');
    await mkdir(join(directory, 'reports'));
    await writeFile(join(directory, 'reports/audit.json'), '{}');
    assert.equal(assertCleanSnapshot(directory), sha);
    await writeFile(join(directory, 'src/app.ts'), 'export const value = 2;\n');
    assert.throws(() => assertCleanSnapshot(directory), /tracked source/);
    git('add', 'src/app.ts');
    assert.throws(() => assertCleanSnapshot(directory), /tracked source/);
    git('restore', '--staged', 'src/app.ts');
    git('restore', 'src/app.ts');
    await writeFile(join(directory, 'src/extra.ts'), 'export const forged = true;\n');
    assert.throws(() => assertCleanSnapshot(directory), /untracked source/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
