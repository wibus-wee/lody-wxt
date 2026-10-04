import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  AttachmentCleanupError,
  createAttachmentClient,
  FILE_MAX_BYTES,
  FILE_PART_BYTES,
  FILE_PREVIEW_BYTES,
  IMAGE_MAX_BYTES,
} from '../dist/attachments/index.js';
import { IncrementalSha256 } from '../dist/attachments/infrastructure/incremental-sha256.js';

const location = { workspaceId: 'workspace', sessionId: 'session' };
const auth = { getToken: async () => 'credential' };
const json = (value) => Response.json(value);
const source = (size, type = 'application/octet-stream', fileName = 'a.txt') => ({
  blob: new Blob([new Uint8Array(size)], { type }),
  fileName,
});
const input = (size) => ({ ...location, ...source(size), textPreview: true });
const client = (fetch) => createAttachmentClient({ origin: 'https://relay.example', auth, fetch });
const filePayload = (headers, fileId = 'file') => ({
  type: 'file',
  fileId,
  fileName: decodeURIComponent(headers.get('x-file-name')),
  mimeType: headers.get('x-file-mime-type'),
  sizeBytes: Number(headers.get('x-file-size-bytes')),
  sha256: headers.get('x-file-sha256'),
  textPreview: true,
  transport: 'r2',
  uploadedAt: 1,
});
const code = (expected) => (error) => error.code === expected;

for (const length of [1, 55, 56, 63, 64, 65, 4097]) {
  test(`incremental SHA256 matches independent implementation at ${length} bytes`, () => {
    const bytes = Uint8Array.from({ length }, (_, index) => index % 251);
    const hasher = new IncrementalSha256();
    for (let offset = 0; offset < bytes.length; offset += 13)
      hasher.update(bytes.subarray(offset, offset + 13));
    assert.equal(hasher.digestHex(), createHash('sha256').update(bytes).digest('hex'));
  });
}

test('single-shot includes canonical hash and encoded metadata with explicit credentials', async () => {
  const sdk = client(async (url, init) => {
    assert.equal(url, 'https://relay.example/api/workspaces/workspace/session-files/upload');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.get('Authorization'), 'Bearer credential');
    assert.equal(init.headers.get('x-file-name'), encodeURIComponent('文 档.txt'));
    assert.equal(init.headers.get('x-session-id'), 'session');
    assert.equal(init.headers.get('x-file-text-preview'), 'true');
    assert.equal(
      init.headers.get('x-file-sha256'),
      createHash('sha256').update(new Uint8Array(3)).digest('hex'),
    );
    return json({ file: filePayload(init.headers) });
  });
  assert.equal((await sdk.uploadFile({ ...input(3), fileName: '文 档.txt' })).sizeBytes, 3);
});

test('16 MiB exact threshold uses single-shot and next byte uses awaited parts and complete', async () => {
  for (const size of [FILE_PART_BYTES, FILE_PART_BYTES + 1]) {
    const calls = [];
    let metadata;
    const sdk = client(async (url, init) => {
      calls.push(url.split('/session-files')[1]);
      if (url.endsWith('/upload')) return json(filePayload(init.headers));
      if (url.endsWith('/create')) {
        metadata = init.headers;
        return json({ uploadId: 'upload+id', fileId: 'file' });
      }
      if (url.includes('/part/')) {
        assert.equal(init.method, 'PUT');
        assert.equal(init.headers.get('x-file-id'), 'file');
        assert.equal(init.headers.get('x-file-part-size-bytes'), String(init.body.size));
        return json({ etag: `etag-${calls.length - 1}` });
      }
      assert.deepEqual(JSON.parse(init.body), {
        parts: [
          { partNumber: 1, etag: 'etag-1' },
          { partNumber: 2, etag: 'etag-2' },
        ],
      });
      return json(filePayload(metadata));
    });
    await sdk.uploadFile(input(size));
    assert.deepEqual(
      calls,
      size === FILE_PART_BYTES
        ? ['/upload']
        : [
            '/multipart/create',
            '/multipart/upload%2Bid/part/1',
            '/multipart/upload%2Bid/part/2',
            '/multipart/upload%2Bid/complete',
          ],
    );
  }
});

test('invalid inputs are rejected before auth and requests; image count and size are bounded', async () => {
  let calls = 0;
  const sdk = createAttachmentClient({
    origin: 'https://relay.example',
    auth: {
      getToken: async () => {
        calls++;
        return 'token';
      },
    },
    fetch: async () => {
      calls++;
      return json({});
    },
  });
  for (const size of [0, FILE_MAX_BYTES + 1])
    await assert.rejects(sdk.uploadFile(input(size)), code('invalid_argument'));
  for (const images of [
    [],
    Array.from({ length: 9 }).fill(source(1, 'image/png', 'a.png')),
    [source(IMAGE_MAX_BYTES + 1, 'image/png', 'a.png')],
    [source(1, 'image/png', 'a.exe')],
    [source(1, 'text/plain', 'a.png')],
  ]) {
    await assert.rejects(sdk.uploadImages({ ...location, images }), code('invalid_argument'));
  }
  assert.equal(calls, 0);
});

test('8 images at 5 MiB each use individual FormData bodies without a fabricated Content-Type', async () => {
  let count = 0;
  const sdk = client(async (url, init) => {
    count++;
    assert.equal(url, 'https://relay.example/api/workspaces/workspace/session-images/upload');
    assert.ok(init.body instanceof FormData);
    assert.equal(init.body.get('sessionId'), 'session');
    assert.equal(init.body.get('file').size, IMAGE_MAX_BYTES);
    assert.equal(init.headers.has('Content-Type'), false);
    return json({
      image: {
        type: 'image',
        imageId: `image${count}`,
        mimeType: 'image/png',
        sizeBytes: IMAGE_MAX_BYTES,
      },
    });
  });
  assert.equal(
    (
      await sdk.uploadImages({
        ...location,
        images: Array.from({ length: 8 }).fill(source(IMAGE_MAX_BYTES, 'image/png', 'a.png')),
      })
    ).length,
    8,
  );
  assert.equal(count, 8);
});

test('multipart protocol failure waits for cleanup and exposes cleanup failure', async () => {
  for (const cleanupFails of [false, true]) {
    let cleanupStarted;
    const started = new Promise((resolve) => {
      cleanupStarted = resolve;
    });
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let settled = false;
    const sdk = client(async (url, init) => {
      if (url.endsWith('/create')) return json({ uploadId: 'upload', fileId: 'file' });
      if (init.method === 'PUT') return json({ etag: '' });
      assert.equal(init.method, 'DELETE');
      assert.equal(init.signal.aborted, false);
      cleanupStarted();
      await held;
      return new Response(null, { status: cleanupFails ? 503 : 204 });
    });
    const upload = sdk.uploadFile(input(FILE_PART_BYTES + 1));
    const checked = assert.rejects(upload, (error) =>
      cleanupFails
        ? error instanceof AttachmentCleanupError &&
          error.transferError.code === 'invalid_response' &&
          error.cleanupError.status === 503
        : error.code === 'invalid_response',
    );
    upload.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await started;
    assert.equal(settled, false);
    release();
    await checked;
  }
});

test('cancellation and timeout of multipart part await independent cleanup', async () => {
  for (const cancelled of [true, false]) {
    const controller = new AbortController();
    let deleted = false;
    const sdk = client(async (url, init) => {
      if (url.endsWith('/create')) return json({ uploadId: 'upload', fileId: 'file' });
      if (init.method === 'DELETE') {
        deleted = true;
        assert.equal(init.signal.aborted, false);
        return new Response(null, { status: 204 });
      }
      if (cancelled) controller.abort();
      return new Promise((_, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        else
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    });
    await assert.rejects(
      sdk.uploadFile(input(FILE_PART_BYTES + 1), { signal: controller.signal, timeoutMs: 1500 }),
      code(cancelled ? 'cancelled' : 'timeout'),
    );
    assert.equal(deleted, true);
  }
});

test('protocol, HTTP, network and auth failures never produce success', async () => {
  await assert.rejects(client(async () => json({})).uploadFile(input(1)), code('invalid_response'));
  await assert.rejects(
    client(async () => new Response('{', { status: 200 })).uploadFile(input(1)),
    code('invalid_response'),
  );
  await assert.rejects(
    client(async () => new Response(null, { status: 413 })).uploadFile(input(1)),
    (error) => error.code === 'http_error' && error.status === 413,
  );
  await assert.rejects(
    client(async () => {
      throw new Error('offline');
    }).uploadFile(input(1)),
    code('network_error'),
  );
  await assert.rejects(
    client(async (_, init) =>
      json({ ...filePayload(init.headers), sha256: 'a'.repeat(64) }),
    ).uploadFile(input(1)),
    code('integrity_error'),
  );
  const sdk = createAttachmentClient({
    origin: 'https://relay.example',
    auth: { getToken: async () => '' },
    fetch: async () => {
      throw new Error('should not fetch');
    },
  });
  await assert.rejects(sdk.uploadFile(input(1)), code('unauthenticated'));
});

test('download returns bytes; preview bounds a server ignoring Range and awaits cancel', async () => {
  const download = { ...location, attachmentId: 'file' };
  const sdk = client(async (_, init) => {
    assert.equal(init.headers.get('Authorization'), 'Bearer credential');
    return new Response('hello', { headers: { 'Content-Type': 'text/plain' } });
  });
  assert.equal(await (await sdk.downloadFile(download)).text(), 'hello');
  assert.equal(await (await sdk.downloadImage(download)).text(), 'hello');
  let cancelled = false;
  const preview = client(async (_, init) => {
    assert.equal(init.headers.get('Range'), `bytes=0-${FILE_PREVIEW_BYTES - 1}`);
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(FILE_PREVIEW_BYTES + 10));
        },
        async cancel() {
          await Promise.resolve();
          cancelled = true;
        },
      }),
    );
  });
  const result = await preview.previewFile({ ...download, sizeBytes: FILE_PREVIEW_BYTES + 10 });
  assert.equal(result.fetchedBytes, FILE_PREVIEW_BYTES);
  assert.equal(result.truncated, true);
  assert.equal(cancelled, true);
});

test('download rejects responses above protocol size limit and stalled response decoding times out', async () => {
  const download = { ...location, attachmentId: 'image' };
  let cancelled = false;
  const oversized = client(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(IMAGE_MAX_BYTES + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  await assert.rejects(oversized.downloadImage(download), code('invalid_response'));
  assert.equal(cancelled, true);
  await assert.rejects(
    client(async () => new Response(new ReadableStream())).downloadImage(download, {
      timeoutMs: 20,
    }),
    code('timeout'),
  );
});

for (const [original, normalized] of [
  [' report.txt ', 'report.txt'],
  ['a/b\\c\u0001.txt', 'a_b_c_.txt'],
  ['a'.repeat(260), 'a'.repeat(255)],
]) {
  test('successful uploads accept the server-normalized filename', async () => {
    for (const size of [1, FILE_PART_BYTES + 1]) {
      let metadata;
      const sdk = client(async (url, init) => {
        assert.notEqual(init.method, 'DELETE');
        if (url.endsWith('/create')) {
          metadata = init.headers;
          return json({ uploadId: 'upload', fileId: 'file' });
        }
        if (url.includes('/part/')) return json({ etag: 'etag' });
        return Response.json(
          { ...filePayload(metadata ?? init.headers), fileName: normalized },
          { status: 201 },
        );
      });
      assert.equal(
        (await sdk.uploadFile({ ...input(size), fileName: original })).fileName,
        normalized,
      );
    }
  });
}

test('accepting canonical filenames does not relax content integrity checks', async () => {
  for (const patch of [{ sizeBytes: 2 }, { sha256: 'f'.repeat(64) }]) {
    await assert.rejects(
      client(async (_, init) =>
        json({ ...filePayload(init.headers), fileName: 'canonical.txt', ...patch }),
      ).uploadFile(input(1)),
      code('integrity_error'),
    );
  }
});
