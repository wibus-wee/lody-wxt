import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import { compress } from '@loro-dev/streams-crdt/zstd';

import {
  ConvexShareManagement,
  createSessionShareSecret,
  createSessionShareUrl,
  decodeShareHistoryBytes,
  hashSessionShareSecret,
  openStaticShare,
  parseSessionShareFragment,
  prepareSharePackage,
  uploadPreparedShare,
  validateShareHistory,
} from '../dist/index.js';
const origin = 'https://share-api.example';
const readerSecret = 'a'.repeat(64);
const uploadSecret = 'b'.repeat(64);
const history = [
  {
    id: 'u1',
    role: 'user',
    userId: 'private-user',
    inputConfig: { token: 'private-config' },
    items: [
      { type: 'text', text: 'Hello' },
      { type: 'file', fileId: 'private-file', fileName: 'private.txt' },
    ],
  },
  {
    id: 'a1',
    role: 'assistant',
    items: [
      {
        type: 'tool_call',
        title: 'Inspect',
        permissionRequest: { id: 'live' },
        content: [{ type: 'terminal_output', text: 'secret terminal' }],
      },
      { type: 'system_notice', name: 'task_proposal' },
      { type: 'text', text: `https://reader.example/s/s1#access=v1.${readerSecret}` },
    ],
  },
];
const prepare = (extra = {}) =>
  prepareSharePackage({
    rootSourceId: 'root',
    conversations: [{ sourceId: 'root', title: 'Shared conversation', history }],
    capturedAt: '2026-10-04T00:00:00.000Z',
    readAttachment: async () => {
      throw new Error('Unrequested attachment read');
    },
    ...extra,
  });
const decode = (prepared) =>
  JSON.parse(
    new TextDecoder().decode(
      prepared.objects.get(prepared.manifest.conversations[0].historyObjectId),
    ),
  );
test('share capture removes live identity, proposals, terminal output, capabilities and unsupported files without changing source', async () => {
  const before = structuredClone(history);
  const prepared = await prepare();
  const serialized = JSON.stringify(decode(prepared));
  for (const privateValue of [
    'private-user',
    'private-config',
    'private-file',
    'private.txt',
    'secret terminal',
    'task_proposal',
    'permissionRequest',
    readerSecret,
  ])
    assert.ok(!serialized.includes(privateValue), privateValue);
  assert.match(serialized, /File attachment not included/);
  assert.match(serialized, /#access=omitted/);
  assert.deepEqual(history, before);
  assert.deepEqual(prepared.sourceIds, [{ sourceId: 'root', conversationId: 'c1' }]);
});
test('share image export copies only typed references, preserves stable conversation identities and detaches bytes', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const reads = [];
  const prepared = await prepare({
    previousSourceIds: [{ sourceId: 'root', conversationId: 'stable' }],
    conversations: [
      {
        sourceId: 'root',
        title: 'Root',
        history: [
          {
            id: 'u',
            role: 'user',
            items: [
              {
                type: 'image',
                imageId: 'image1',
                storageSessionId: 'draft1',
                fileName: 'image.png',
              },
              { type: 'tool_call', rawOutput: { type: 'image', imageId: 'not-fetchable' } },
            ],
          },
        ],
      },
    ],
    readAttachment: async (source) => {
      reads.push(structuredClone(source));
      return { bytes, mediaType: 'image/png' };
    },
  });
  bytes[0] = 99;
  assert.equal(reads.length, 1);
  assert.equal(reads[0].reference.storageSessionId, 'draft1');
  assert.equal(prepared.manifest.rootConversationId, 'stable');
  assert.equal(prepared.objects.get('a1')[0], 1);
  const image = decode(prepared)[0].items[0];
  assert.equal(image.imageId, 'a1');
  assert.equal(image.storageSessionId, undefined);
});
test('share upload verifies bytes, uses upload capability only, seals last and supports immutable retry', async () => {
  const prepared = await prepare();
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({
      url,
      method: init.method,
      auth: new Headers(init.headers).get('Authorization'),
      credentials: init.credentials,
      body: new Uint8Array(init.body),
    });
    return new Response(null, { status: 204 });
  };
  await uploadPreparedShare({ origin, deploymentId: 'd1', secret: uploadSecret, prepared, fetch });
  await uploadPreparedShare({ origin, deploymentId: 'd1', secret: uploadSecret, prepared, fetch });
  assert.equal(requests[1].url, `${origin}/api/share-deployments/d1/seal`);
  assert.equal(requests[1].method, 'POST');
  assert.ok(
    requests.every(
      (request) => request.auth === `Bearer ${uploadSecret}` && request.credentials === 'omit',
    ),
  );
  assert.deepEqual(requests.slice(0, 2), requests.slice(2));
  const corrupt = structuredClone(prepared);
  corrupt.manifestBytes[0] = 0;
  await assert.rejects(
    uploadPreparedShare({
      origin,
      deploymentId: 'd1',
      secret: uploadSecret,
      prepared: corrupt,
      fetch,
    }),
    /manifest hash mismatch/,
  );
  assert.equal(requests.length, 4);
  const corruptObject = structuredClone(prepared);
  corruptObject.objects.values().next().value[0] = 0;
  await assert.rejects(
    uploadPreparedShare({
      origin,
      deploymentId: 'd1',
      secret: uploadSecret,
      prepared: corruptObject,
      fetch,
    }),
    /Invalid share object/,
  );
  assert.equal(requests.length, 4);
});
test('public reader resolves once, pins deployment, verifies object hash and rejects mismatched identity', async () => {
  const prepared = await prepare();
  const requests = [];
  const fetch = async (url, init) => {
    requests.push(url);
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${readerSecret}`);
    assert.equal(init.credentials, 'omit');
    if (url === `${origin}/api/shares/s1`)
      return Response.json({ shareId: 's1', deploymentId: 'd1', manifest: prepared.manifest });
    const objectId = url.split('/').at(-1);
    return new Response(prepared.objects.get(objectId));
  };
  const share = await openStaticShare({ origin, shareId: 's1', secret: readerSecret, fetch });
  assert.deepEqual(await share.readHistory('c1'), validateShareHistory(decode(prepared)));
  assert.match(requests[1], /\/deployments\/d1\/objects\//);
  await assert.rejects(
    openStaticShare({
      origin,
      shareId: 's1',
      secret: readerSecret,
      fetch: async () =>
        Response.json({ shareId: 'wrong', deploymentId: 'd1', manifest: prepared.manifest }),
    }),
    /identity/,
  );
  const corrupt = await openStaticShare({
    origin,
    shareId: 's1',
    secret: readerSecret,
    fetch: async (url) =>
      url.endsWith('/s1')
        ? Response.json({ shareId: 's1', deploymentId: 'd1', manifest: prepared.manifest })
        : new Response('corrupt'),
  });
  await assert.rejects(corrupt.readHistory('c1'), /Invalid share object/);
});
test('sharing rejects malformed inventory graphs, duplicate histories and task proposals at read boundary', async () => {
  const prepared = await prepare();
  const manifest = structuredClone(prepared.manifest);
  manifest.conversations[0].parentConversationId = 'c1';
  await assert.rejects(
    openStaticShare({
      origin,
      shareId: 's1',
      secret: readerSecret,
      fetch: async () => Response.json({ shareId: 's1', deploymentId: 'd1', manifest }),
    }),
    /inventory/,
  );
  assert.throws(
    () =>
      validateShareHistory([
        { id: 'a', role: 'user' },
        { id: 'a', role: 'assistant' },
      ]),
    /history/,
  );
  assert.throws(
    () =>
      validateShareHistory([
        { id: 'a', role: 'assistant', items: [{ type: 'system_notice', name: 'task_proposal' }] },
      ]),
    /Task proposals/,
  );
});
test('share control plane uses exact authenticated Convex contracts, same request identity and authoritative publication/revocation', async () => {
  const prepared = await prepare();
  const calls = [];
  const view = {
    shareId: 's1',
    rootSessionId: 'root',
    publisherUserId: 'user1',
    status: 'draft',
    revision: 1,
    credentialVersion: 1,
    title: 'Title',
    createdAt: 1,
    updatedAt: 1,
  };
  let invalid = false;
  const management = new ConvexShareManagement({
    origin: 'https://convex.example',
    getJwt: async () => 'header.claims.signature',
    fetch: async (url, init) => {
      assert.equal(
        new Headers(init.headers).get('Authorization'),
        'Bearer header.claims.signature',
      );
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      const value = body.path.endsWith(':beginDeployment')
        ? { ...view, deploymentId: 'd1' }
        : body.path.endsWith(':publishDeployment')
          ? { ...view, status: 'active', currentDeploymentId: invalid ? 'different' : 'd1' }
          : { ...view, status: invalid ? 'active' : 'revoked' };
      return Response.json({ status: 'success', value });
    },
  });
  const input = {
    workspaceId: 'workspace1',
    rootSessionId: 'root',
    requestId: 'immutable-request',
    credentialHash: await hashSessionShareSecret(readerSecret),
    uploadCredentialHash: await hashSessionShareSecret(uploadSecret),
    manifest: prepared.manifest,
    sourceIds: prepared.sourceIds,
  };
  await management.beginDeployment(input);
  await management.beginDeployment(input);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].body.path, 'sessionSharing:beginDeployment');
  assert.equal(calls[0].body.format, 'json');
  assert.equal(calls[0].url, 'https://convex.example/api/mutation');
  assert.equal((await management.publishDeployment('d1')).status, 'active');
  assert.equal((await management.revoke({ shareId: 's1', expectedRevision: 1 })).status, 'revoked');
  invalid = true;
  await assert.rejects(management.publishDeployment('d1'), /not confirmed/);
  await assert.rejects(management.revoke({ shareId: 's1', expectedRevision: 1 }), /not confirmed/);
});
test('reader secrets remain in versioned fragments and hashes use the official domain separator', async () => {
  assert.match(createSessionShareSecret(), /^[a-f0-9]{64}$/);
  const url = new URL(createSessionShareUrl('s1', readerSecret, 'https://reader.example'));
  assert.equal(url.search, '');
  assert.equal(parseSessionShareFragment(url.hash), readerSecret);
  assert.equal(parseSessionShareFragment(`?access=${readerSecret}`), null);
  assert.throws(
    () => createSessionShareUrl('s1', readerSecret, 'https://reader.example/leak'),
    /origin/,
  );
  const expected = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`lody-session-share-access-v1:${readerSecret}`),
  );
  assert.equal(await hashSessionShareSecret(readerSecret), Buffer.from(expected).toString('hex'));
});

test('compressed share histories use bounded single-frame decoding and reject truncated or dishonest size claims', async () => {
  const content = 'This is a portable share snapshot. '.repeat(1000);
  const prepared = await prepare({
    conversations: [
      {
        sourceId: 'root',
        title: 'Compressed',
        history: [{ id: 'text', role: 'assistant', items: [{ type: 'text', text: content }] }],
      },
    ],
    compressHistory: compress,
  });
  assert.equal(prepared.manifest.formatVersion, 2);
  const descriptor = prepared.manifest.objects[0];
  const encoded = prepared.objects.get(descriptor.id);
  assert.equal(descriptor.contentEncoding, 'zstd');
  const decoded = await decodeShareHistoryBytes(encoded, descriptor);
  assert.equal(JSON.parse(new TextDecoder().decode(decoded))[0].items[0].text, content);
  await assert.rejects(
    decodeShareHistoryBytes(encoded, {
      ...descriptor,
      decodedSizeBytes: descriptor.decodedSizeBytes + 1,
    }),
    /Invalid compressed/,
  );
  await assert.rejects(
    decodeShareHistoryBytes(encoded.slice(0, -1), descriptor),
    /Invalid compressed/,
  );
  const concatenated = new Uint8Array(encoded.length * 2);
  concatenated.set(encoded);
  concatenated.set(encoded, encoded.length);
  await assert.rejects(decodeShareHistoryBytes(concatenated, descriptor), /Invalid compressed/);
});

test('legacy prompt-only user turns preserve their question as display text without exporting runtime config or duplicating modern items', async () => {
  const question = 'Previously asked question';
  const prepared = await prepare({
    conversations: [
      {
        sourceId: 'root',
        title: 'Legacy',
        history: [
          {
            id: 'legacy',
            role: 'user',
            inputConfig: {
              prompt: question,
              cliType: 'builtin',
              agentType: 'codex',
              token: 'secret-setting',
            },
          },
          {
            id: 'modern',
            role: 'user',
            items: [{ type: 'text', text: 'Visible edited message' }],
            inputConfig: { prompt: 'Old backing value' },
          },
        ],
      },
    ],
  });
  const captured = decode(prepared);
  assert.deepEqual(captured[0].items, [{ type: 'text', text: question }]);
  assert.equal(captured[0].inputConfig, undefined);
  assert.deepEqual(captured[1].items, [{ type: 'text', text: 'Visible edited message' }]);
  assert.ok(!JSON.stringify(captured).includes('secret-setting'));
});
