import type { SessionShareManagementEntry } from '@lody-mobile/sdk';
import { prepareSharePackage } from '@lody-mobile/sdk';
import { expect, it, vi } from 'vitest';

import {
  readPendingReset,
  readPendingShare,
  readShareCredential,
  shareScope,
} from '../../src/features/sharing/journal';
import type { ShareClient } from '../../src/features/sharing/publisher';
import {
  captureShare,
  discardShare,
  publishShare,
  resetShareLink,
  revokeShare,
} from '../../src/features/sharing/publisher';

async function fixture() {
  const rootSessionId = 'session-one';
  const prepared = await prepareSharePackage({
    rootSourceId: rootSessionId,
    capturedAt: '2026-10-04T08:00:00.000Z',
    conversations: [
      {
        sourceId: rootSessionId,
        title: 'Snapshot',
        history: [{ id: 'turn', role: 'user', items: [{ type: 'text', text: 'Frozen message' }] }],
      },
    ],
    readAttachment: async () => {
      throw new Error('No attachments');
    },
  });
  let entry: SessionShareManagementEntry | null = null;
  const base = {
    shareId: 'share-one',
    rootSessionId,
    publisherUserId: 'publisher',
    status: 'draft' as const,
    revision: 1,
    credentialVersion: 1,
    title: 'Snapshot',
    createdAt: 1,
    updatedAt: 1,
  };
  const begin = vi.fn(async () => {
    entry = {
      ...base,
      canManage: true,
      canRevoke: true,
      sourceIds: prepared.sourceIds,
      selectedSourceIds: [rootSessionId],
    };
    return { ...base, deploymentId: 'deployment-one' };
  });
  const upload = vi.fn(async () => {});
  const publish = vi.fn(async () => {
    if (!entry) throw new Error('Missing share');
    entry = { ...entry, status: 'active', revision: 2, currentDeploymentId: 'deployment-one' };
    return entry;
  });
  const revoke = vi.fn(async () => {
    if (!entry) throw new Error('Missing share');
    entry = { ...entry, status: 'revoked', revision: entry.revision + 1 };
    return entry;
  });
  const client: ShareClient = {
    accountKey: crypto.randomUUID(),
    sharing: {
      publicOrigin: 'https://share.example.test',
      apiOrigin: 'https://share-api.example.test',
      verifyCredential: async () => {},
      prepare: async () => prepared,
      getManagement: async () => entry,
      list: async () => ({ page: [], isDone: true, continueCursor: '' }),
      beginDeployment: begin,
      upload,
      publishDeployment: publish,
      revoke,
      resetCredential: async () => {
        throw new Error('Not used');
      },
    },
  };
  return { client, rootSessionId, prepared, begin, upload, publish, revoke };
}

it('persists the preview before begin and resumes identical deployment bytes and secrets after failed upload', async () => {
  const { client, rootSessionId, begin, upload, prepared } = await fixture();
  const pending = await captureShare(client, rootSessionId, [rootSessionId], null);
  const scope = shareScope(client.accountKey, rootSessionId);
  expect(begin).not.toHaveBeenCalled();
  expect((await readPendingShare(scope))?.prepared.objects).toEqual(prepared.objects);
  expect(
    await readPendingShare(shareScope(`other-origin:${client.accountKey}`, rootSessionId)),
  ).toBeNull();
  upload.mockRejectedValueOnce(new Error('Upload confirmation lost'));
  await expect(publishShare(client, rootSessionId)).rejects.toThrow('Upload confirmation lost');
  const retained = await readPendingShare(scope);
  expect(retained?.requestId).toBe(pending.requestId);
  expect(retained?.deployment?.deploymentId).toBe('deployment-one');
  await expect(discardShare(client, rootSessionId)).rejects.toThrow('发布请求已发出');
  await publishShare(client, rootSessionId);
  expect(begin).toHaveBeenCalledTimes(1);
  expect(upload.mock.calls[0]).toEqual(upload.mock.calls[1]);
  expect(await readPendingShare(scope)).toBeNull();
  expect((await readShareCredential(client.accountKey, 'share-one'))?.secret).toBe(
    pending.readerSecret,
  );
});

it('queries uncertain publication before retrying and confirms revocation through cloud state', async () => {
  const { client, rootSessionId, publish, revoke } = await fixture();
  await captureShare(client, rootSessionId, [rootSessionId], null);
  const initialPublish = client.sharing.publishDeployment;
  client.sharing.publishDeployment = async (id) => {
    await initialPublish(id);
    throw new Error('Response lost');
  };
  await expect(publishShare(client, rootSessionId)).rejects.toThrow('Response lost');
  const recovered = await publishShare(client, rootSessionId);
  expect(recovered.status).toBe('active');
  expect(publish).toHaveBeenCalledTimes(1);
  expect((await revokeShare(client, rootSessionId, recovered)).status).toBe('revoked');
  expect(revoke).toHaveBeenCalledTimes(1);
});

it('rejects restoring a prepared share to a changed deployment and permits discard before publication', async () => {
  const { client, rootSessionId, begin } = await fixture();
  await captureShare(client, rootSessionId, [rootSessionId], null);
  const other: ShareClient = {
    ...client,
    sharing: { ...client.sharing, publicOrigin: 'https://different.example.test' },
  };
  await expect(publishShare(other, rootSessionId)).rejects.toThrow('公开分享地址已改变');
  expect(begin).not.toHaveBeenCalled();
  await discardShare(client, rootSessionId);
  expect(await readPendingShare(shareScope(client.accountKey, rootSessionId))).toBeNull();
});

it('recovers reset credentials only after the saved secret passes a public capability read', async () => {
  const { client, rootSessionId } = await fixture();
  await captureShare(client, rootSessionId, [rootSessionId], null);
  let entry = await publishShare(client, rootSessionId);
  const oldSecret = (await readShareCredential(client.accountKey, entry.shareId))!.secret;
  client.sharing.getManagement = async () => entry;
  const reset = vi.fn(async () => {
    entry = {
      ...entry,
      revision: entry.revision + 1,
      credentialVersion: entry.credentialVersion + 1,
    };
    throw new Error('Reset confirmation lost');
  });
  client.sharing.resetCredential = reset;
  await expect(resetShareLink(client, rootSessionId, entry)).rejects.toThrow(
    'Reset confirmation lost',
  );
  const pending = await readPendingReset(shareScope(client.accountKey, rootSessionId));
  expect(pending?.secret).not.toBe(oldSecret);
  client.sharing.verifyCredential = vi.fn(async () => {
    throw new Error('Another reset won');
  });
  await expect(resetShareLink(client, rootSessionId, entry)).rejects.toThrow('Another reset won');
  expect((await readShareCredential(client.accountKey, entry.shareId))!.secret).toBe(oldSecret);
  expect(await readPendingReset(shareScope(client.accountKey, rootSessionId))).toEqual(pending);
  client.sharing.verifyCredential = vi.fn(async () => {});
  await resetShareLink(client, rootSessionId, entry);
  expect(client.sharing.verifyCredential).toHaveBeenCalledWith(entry.shareId, pending!.secret);
  expect(reset).toHaveBeenCalledTimes(1);
  expect((await readShareCredential(client.accountKey, entry.shareId))!.secret).toBe(
    pending!.secret,
  );
  expect(await readPendingReset(shareScope(client.accountKey, rootSessionId))).toBeNull();
});
