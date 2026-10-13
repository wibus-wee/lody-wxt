import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

// The legacy appcast remains unchanged. This optional sidecar describes byte
// ranges in the exact published ZIP, not a second copy of the extension.
const inspect = String.raw`import hashlib,json,re,stat,struct,sys,zipfile
archive=sys.argv[1]
data=open(archive,'rb').read()
assert 0 < len(data) <= 256*1024*1024, 'Invalid archive size'
entries=[]
seen=set()
files=set()
ranges=[]
total=0
with zipfile.ZipFile(archive) as z:
 infos=z.infolist()
 assert 0 < len(infos) <= 10000, 'Invalid inventory size'
 for i in infos:
  name=i.filename
  assert i.orig_filename == name, 'Truncated name'
  assert len(name.encode('utf-8')) <= 512, 'Oversized path'
  parts=name.rstrip('/').split('/')
  assert all(p not in ('','.','..') and not p.endswith((' ','.')) for p in parts), 'Unsafe path'
  assert not any(ord(c)<32 for c in name) and not any(c in name for c in '\\:*?"<>|'), 'Unsafe path'
  assert all(not re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?',p,re.I) for p in parts), 'Reserved path'
  key='/'.join(parts).casefold()
  assert key not in seen, 'Duplicate path'
  seen.add(key)
  if not i.is_dir(): files.add(key)
  assert name.startswith('lody/') or name in ('INSTALL.md','build-info.json'), 'Unexpected root'
  mode=stat.S_IFMT(i.external_attr >> 16)
  assert mode in (0,stat.S_IFREG,stat.S_IFDIR), 'Nonregular entry'
  assert mode != stat.S_IFDIR or i.is_dir(), 'Invalid directory'
  assert not i.flag_bits & 1 and i.compress_type in (0,8), 'Unsupported encoding'
  assert i.file_size <= 64*1024*1024, 'Oversized file'
  total+=i.file_size
  assert total <= 512*1024*1024, 'Oversized expanded archive'
  start=i.header_offset
  assert 0 <= start and start+30 <= z.start_dir, 'Invalid local header'
  h=struct.unpack_from('<IHHHHHIIIHH',data,start)
  assert h[0] == 0x04034b50 and h[2] == i.flag_bits and h[3] == i.compress_type, 'Header mismatch'
  raw_name=data[start+30:start+30+h[9]]
  assert raw_name.decode('utf-8' if i.flag_bits & 0x800 else 'cp437') == name, 'Name mismatch'
  offset=start+30+h[9]+h[10]
  end=offset+i.compress_size
  assert offset <= end <= z.start_dir, 'Invalid data range'
  ranges.append((start,end))
  content=z.read(i) # zipfile checks CRC, decompression and overlapping-entry attacks.
  assert len(content) == i.file_size, 'Size mismatch'
  if i.is_dir():
   assert i.file_size == 0 and mode in (0,stat.S_IFDIR), 'Invalid directory'
   continue
  if not name.startswith('lody/'): continue
  entries.append({'path':name[5:],'size':len(content),'sha256':hashlib.sha256(content).hexdigest(),'offset':offset,'compressedSize':i.compress_size,'compressedSha256':hashlib.sha256(data[offset:end]).hexdigest(),'method':i.compress_type})
 for key in seen:
  parts=key.split('/')
  assert not any('/'.join(parts[:n]) in files for n in range(1,len(parts))), 'File-directory collision'
 for previous,current in zip(sorted(ranges),sorted(ranges)[1:]):
  assert previous[1] <= current[0], 'Overlapping ranges'
 manifest=json.loads(z.read('lody/manifest.json'))
 assert manifest.get('name') == 'Lody' and manifest.get('manifest_version') == 3, 'Invalid application'
 print(json.dumps({'version':manifest['version'],'files':sorted(entries,key=lambda x:x['path'])}))
`;

export function createUpdateIndex(archive, version) {
  assert.match(version, stableVersion);
  assert.ok(version !== '0.0.0' && version.split('.').every((n) => Number(n) <= 65535));
  const parsed = JSON.parse(
    execFileSync('python3', ['-I', '-c', inspect, archive], {
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  assert.equal(parsed.version, version, 'Index version must match packaged manifest');
  const bytes = readFileSync(archive);
  return {
    schemaVersion: 1,
    application: 'lody-wxt',
    version,
    archive: {
      length: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    files: parsed.files,
  };
}
