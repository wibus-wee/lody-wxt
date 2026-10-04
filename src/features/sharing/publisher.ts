import type { SessionShareManagementEntry } from '@lody-mobile/sdk';
import { createSessionShareSecret, hashSessionShareSecret } from '@lody-mobile/sdk';

import type { LodyClient } from '../connection/client';
import type { PendingShare } from './journal';
import {
  clearPendingReset,
  clearPendingShare,
  readPendingReset,
  readPendingShare,
  saveShareCredential,
  shareScope,
  withShareLock,
  writePendingReset,
  writePendingShare,
} from './journal';

export type ShareClient = Pick<LodyClient, 'sharing' | 'accountKey'>;

export async function captureShare(
  client: ShareClient,
  rootSessionId: string,
  sessionIds: readonly string[],
  expected: SessionShareManagementEntry | null,
) {
  const origin = client.sharing.publicOrigin;
  const apiOrigin = client.sharing.apiOrigin;
  if (!origin || !apiOrigin) throw new Error('此部署尚未配置公开分享地址或数据服务。');
  if (expected && (!expected.canManage || expected.status === 'draft'))
    throw new Error('此分享不能创建新版本，请先恢复或撤销现有草稿。');
  const scope = shareScope(client.accountKey, rootSessionId);
  return withShareLock(scope, async () => {
    if (await readPendingReset(scope))
      throw new Error('访问链接的重置尚待确认，请先恢复或撤销分享。');
    if (await readPendingShare(scope)) throw new Error('已有保留的分享预览，请先恢复或丢弃。');
    const prepared = await client.sharing.prepare({
      rootSessionId,
      sessionIds,
      capturedAt: new Date().toISOString(),
      ...(expected ? { previousSourceIds: expected.sourceIds } : {}),
    });
    const pending: PendingShare = {
      origin,
      apiOrigin,
      rootSessionId,
      prepared,
      requestId: crypto.randomUUID(),
      uploadSecret: createSessionShareSecret(),
      readerSecret: expected?.status === 'active' ? null : createSessionShareSecret(),
      expected: expected?.status === 'active' ? expected : null,
      deployment: null,
      sealed: false,
      confirmed: false,
    };
    await writePendingShare(scope, pending);
    return pending;
  });
}

/** Every retry reads the immutable journal under the same cross-window lock. */
export async function publishShare(
  client: ShareClient,
  rootSessionId: string,
  onProgress?: (uploaded: number, total: number) => void,
) {
  const scope = shareScope(client.accountKey, rootSessionId);
  return withShareLock(scope, async () => {
    let pending = await readPendingShare(scope);
    if (!pending) throw new Error('没有可恢复的分享，请先预览。');
    if (
      pending.rootSessionId !== rootSessionId ||
      pending.origin !== client.sharing.publicOrigin ||
      pending.apiOrigin !== client.sharing.apiOrigin
    )
      throw new Error('公开分享地址已改变，无法向另一个部署恢复上传。');
    pending = { ...pending, confirmed: true };
    await writePendingShare(scope, pending);
    let current = await client.sharing.getManagement(
      rootSessionId,
      pending.deployment?.shareId ?? pending.expected?.shareId,
    );
    if (
      pending.deployment &&
      current?.status === 'active' &&
      current.currentDeploymentId === pending.deployment.deploymentId
    ) {
      if (pending.readerSecret)
        await saveShareCredential(client.accountKey, pending.deployment, pending.readerSecret);
      await clearPendingShare(scope);
      return current;
    }
    if (
      pending.expected &&
      (!current ||
        current.shareId !== pending.expected.shareId ||
        current.revision !== pending.expected.revision ||
        current.status !== pending.expected.status)
    )
      throw new Error('云端分享已改变；保留的版本没有继续发布，请重新读取后处理。');
    if (!pending.deployment) {
      const deployment = await client.sharing.beginDeployment({
        rootSessionId,
        requestId: pending.requestId,
        manifest: pending.prepared.manifest,
        sourceIds: pending.prepared.sourceIds,
        uploadCredentialHash: await hashSessionShareSecret(pending.uploadSecret),
        ...(pending.readerSecret
          ? { credentialHash: await hashSessionShareSecret(pending.readerSecret) }
          : {}),
        ...(pending.expected
          ? { shareId: pending.expected.shareId, expectedRevision: pending.expected.revision }
          : {}),
      });
      pending = { ...pending, deployment };
      await writePendingShare(scope, pending);
    }
    const deployment = pending.deployment;
    if (!deployment) throw new Error('分享部署尚未确认。');
    if (pending.readerSecret)
      await saveShareCredential(client.accountKey, deployment, pending.readerSecret);
    if (!pending.sealed) {
      await client.sharing.upload({
        deploymentId: deployment.deploymentId,
        secret: pending.uploadSecret,
        prepared: pending.prepared,
        ...(onProgress ? { onProgress } : {}),
      });
      pending = { ...pending, sealed: true };
      await writePendingShare(scope, pending);
    }
    await client.sharing.publishDeployment(deployment.deploymentId);
    current = await client.sharing.getManagement(rootSessionId, deployment.shareId);
    if (current?.status !== 'active' || current.currentDeploymentId !== deployment.deploymentId)
      throw new Error('发布结果尚未确认，预览与恢复信息已保留。');
    await clearPendingShare(scope);
    return current;
  });
}

export async function discardShare(client: ShareClient, rootSessionId: string) {
  const scope = shareScope(client.accountKey, rootSessionId);
  await withShareLock(scope, async () => {
    const pending = await readPendingShare(scope);
    if (pending?.confirmed) throw new Error('发布请求已发出，请先确认或撤销云端分享。');
    await clearPendingShare(scope);
  });
}

export async function revokeShare(
  client: ShareClient,
  rootSessionId: string,
  share: SessionShareManagementEntry,
) {
  const scope = shareScope(client.accountKey, rootSessionId);
  return withShareLock(scope, async () => {
    const current = await client.sharing.getManagement(rootSessionId, share.shareId);
    if (!current || !current.canRevoke) throw new Error('当前账户没有撤销此分享的权限。');
    if (current.status !== 'revoked')
      await client.sharing.revoke({ shareId: current.shareId, expectedRevision: current.revision });
    const verified = await client.sharing.getManagement(rootSessionId, share.shareId);
    if (verified?.status !== 'revoked') throw new Error('撤销结果尚未确认，请重新读取。');
    const pending = await readPendingShare(scope);
    if (
      pending?.deployment?.shareId === verified.shareId ||
      pending?.expected?.shareId === verified.shareId ||
      (pending && !pending.expected && !pending.deployment)
    )
      await clearPendingShare(scope);
    if ((await readPendingReset(scope))?.shareId === verified.shareId)
      await clearPendingReset(scope);
    return verified;
  });
}

export async function resetShareLink(
  client: ShareClient,
  rootSessionId: string,
  share: SessionShareManagementEntry,
) {
  const scope = shareScope(client.accountKey, rootSessionId);
  return withShareLock(scope, async () => {
    const origin = client.sharing.publicOrigin;
    const apiOrigin = client.sharing.apiOrigin;
    if (!origin || !apiOrigin) throw new Error('此部署尚未配置公开分享地址或数据服务。');
    if (await readPendingShare(scope)) throw new Error('请先完成或撤销待发布的分享。');
    let pending = await readPendingReset(scope);
    if (!pending) {
      if (!share.canManage || share.status !== 'active') throw new Error('当前分享不能重置链接。');
      pending = {
        origin,
        apiOrigin,
        shareId: share.shareId,
        rootSessionId,
        expectedRevision: share.revision,
        credentialVersion: share.credentialVersion,
        secret: createSessionShareSecret(),
      };
      await writePendingReset(scope, pending);
    }
    if (
      pending.origin !== origin ||
      pending.apiOrigin !== apiOrigin ||
      pending.rootSessionId !== rootSessionId ||
      pending.shareId !== share.shareId
    )
      throw new Error('重置请求不属于当前分享部署。');
    let current = await client.sharing.getManagement(rootSessionId, pending.shareId);
    if (!current || current.status !== 'active' || !current.canManage)
      throw new Error('此分享已改变，无法继续重置。');
    if (current.credentialVersion === pending.credentialVersion) {
      if (current.revision !== pending.expectedRevision)
        throw new Error('此分享已更新，保留的重置请求没有执行。');
      await client.sharing.resetCredential({
        shareId: pending.shareId,
        expectedRevision: pending.expectedRevision,
        credentialHash: await hashSessionShareSecret(pending.secret),
      });
      current = await client.sharing.getManagement(rootSessionId, pending.shareId);
    }
    if (
      !current ||
      current.status !== 'active' ||
      current.credentialVersion <= pending.credentialVersion
    )
      throw new Error('链接重置结果尚未确认。');
    // A revision change alone cannot establish which concurrent reset won.
    await client.sharing.verifyCredential(current.shareId, pending.secret);
    await saveShareCredential(client.accountKey, current, pending.secret);
    await clearPendingReset(scope);
    return current;
  });
}
