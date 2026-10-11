import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { safePath } from './common.mjs';

const inspectZip = `
import base64, json, stat, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    entries = z.infolist()
    assert len(entries) <= 10000, 'Too many ZIP entries'
    assert sum(i.file_size for i in entries) <= 400000000, 'ZIP expansion exceeds bound'
    seen, result = set(), {}
    for i in entries:
        p = i.filename
        assert p not in seen, 'Duplicate ZIP entry'
        seen.add(p)
        assert not p.startswith('/') and '\\\\' not in p and all(c not in ('.', '..') for c in p.split('/')), 'Unsafe ZIP path'
        assert not stat.S_ISLNK(i.external_attr >> 16), 'ZIP symlink'
        assert i.file_size <= 100000000, 'Oversized ZIP member'
        if not i.is_dir(): result[p] = base64.b64encode(z.read(i)).decode('ascii')
    print(json.dumps(result))
`;
export async function readArchive(buffer) {
  const directory = await mkdtemp(join(tmpdir(), 'lody-evidence-'));
  try {
    const path = join(directory, 'evidence.zip');
    await writeFile(path, buffer);
    const output = execFileSync('python3', ['-c', inspectZip, path], {
      encoding: 'utf8',
      maxBuffer: 550_000_000,
      timeout: 60000,
    });
    const files = new Map(
      Object.entries(JSON.parse(output)).map(([name, value]) => [
        safePath(name),
        Buffer.from(value, 'base64'),
      ]),
    );
    return (name) => {
      safePath(name);
      assert.ok(files.has(name), `Missing artifact member ${name}`);
      return files.get(name);
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
