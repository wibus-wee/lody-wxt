import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { createUpdateIndex } from './update-index.mjs';

const makeZip = String.raw`import json,sys,zipfile
with zipfile.ZipFile(sys.argv[1],'w') as z:
 for e in json.loads(sys.argv[2]):
  i=zipfile.ZipInfo(e['name']);i.compress_type=e.get('method',8)
  if 'mode' in e: i.external_attr=e['mode'] << 16
  z.writestr(i,e['body'])
`;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const baseline = [
  {
    name: 'lody/manifest.json',
    body: JSON.stringify({ name: 'Lody', manifest_version: 3, version: '0.2.5' }),
  },
  { name: 'lody/assets/stable.js', body: 'unchanged payload', method: 0 },
  { name: 'lody/assets/changed.js', body: 'changed payload'.repeat(1000) },
  { name: 'INSTALL.md', body: 'Install guide' },
  { name: 'build-info.json', body: '{}' },
];
function fixture(t, entries = baseline) {
  const directory = mkdtempSync(path.join(tmpdir(), 'lody-index-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'release.zip');
  execFileSync('python3', ['-I', '-c', makeZip, archive, JSON.stringify(entries)]);
  return archive;
}
test('index byte ranges reproduce exact stored and deflated release files', (t) => {
  const archive = fixture(t);
  const index = createUpdateIndex(archive, '0.2.5');
  const bytes = readFileSync(archive);
  assert.equal(index.archive.sha256, sha(bytes));
  assert.equal(index.archive.length, bytes.length);
  assert.equal(index.files.length, 3);
  for (const file of index.files) {
    const compressed = bytes.subarray(file.offset, file.offset + file.compressedSize);
    assert.equal(sha(compressed), file.compressedSha256);
    const content = file.method === 8 ? inflateRawSync(compressed) : compressed;
    assert.equal(content.length, file.size);
    assert.equal(sha(content), file.sha256);
    assert.equal(content.toString(), baseline.find((e) => e.name === `lody/${file.path}`).body);
  }
  assert.deepEqual(createUpdateIndex(archive, '0.2.5'), index);
});
test('changing one file changes only its content identity', (t) => {
  const before = createUpdateIndex(fixture(t), '0.2.5');
  const after = createUpdateIndex(
    fixture(
      t,
      baseline.map((e) => (e.name.endsWith('changed.js') ? { ...e, body: 'new' } : e)),
    ),
    '0.2.5',
  );
  const changed = after.files.filter(
    (f) => before.files.find((old) => old.path === f.path).sha256 !== f.sha256,
  );
  assert.deepEqual(
    changed.map((f) => f.path),
    ['assets/changed.js'],
  );
});
for (const entry of [
  { name: 'lody/../escape', body: 'x' },
  { name: 'lody/CON.txt', body: 'x' },
  { name: 'lody/unsafe\\name', body: 'x' },
  { name: 'lody/unsafe.', body: 'x' },
  { name: 'lody/assets/STABLE.js', body: 'x' },
  { name: 'lody/assets/stable.js/child', body: 'x' },
  { name: 'outside.txt', body: 'x' },
  { name: 'lody/link', body: 'target', mode: 0o120777 },
  { name: 'lody/bzip', body: 'x', method: 12 },
]) {
  test(`reject unsafe archive entry ${JSON.stringify(entry.name)}`, (t) => {
    assert.throws(() => createUpdateIndex(fixture(t, [...baseline, entry]), '0.2.5'));
  });
}
test('reject version mismatch and altered compressed bytes', (t) => {
  const archive = fixture(t);
  assert.throws(() => createUpdateIndex(archive, '0.2.6'));
  const index = createUpdateIndex(archive, '0.2.5');
  const bytes = readFileSync(archive);
  bytes[index.files.find((f) => f.path.endsWith('stable.js')).offset] ^= 1;
  writeFileSync(archive, bytes);
  assert.throws(() => createUpdateIndex(archive, '0.2.5'));
});
