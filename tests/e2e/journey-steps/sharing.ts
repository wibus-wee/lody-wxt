import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import AxeBuilder from '@axe-core/playwright';
import { When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { JourneyWorld } from './world';
import { ready, restored } from './world';

const requireSdk = createRequire(
  new URL('../../../packages/lody-sdk/package.json', import.meta.url),
);
const { LoroMap } = requireSdk(
  'loro-crdt',
) as typeof import('../../../packages/lody-sdk/node_modules/loro-crdt');

async function openShare(world: JourneyWorld) {
  await world.page.getByRole('button', { name: '会话列表', exact: true }).click();
  await world.page
    .getByRole('button', { name: '管理对话 Historical conversation', exact: true })
    .click();
  await world.page.getByRole('menuitem', { name: '分享会话…', exact: true }).click();
  await expect(world.page.getByRole('dialog')).toBeVisible();
}
async function journal(world: JourneyWorld) {
  return world.page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('lody-session-shares');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<
      Array<{
        requestId: string;
        uploadSecret: string;
        readerSecret: string;
        prepared: {
          manifestHash: string;
          manifestBytes: Uint8Array;
          objects: Map<string, Uint8Array>;
        };
        deployment: { deploymentId: string };
      }>
    >((resolve, reject) => {
      const request = db.transaction('pending').objectStore('pending').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.map((row) => ({
      requestId: row.requestId,
      uploadSecret: row.uploadSecret,
      readerSecret: row.readerSecret,
      manifestHash: row.prepared.manifestHash,
      manifestBytes: Array.from(row.prepared.manifestBytes),
      objects: Array.from(row.prepared.objects, ([id, bytes]) => [id, Array.from(bytes)]),
      deploymentId: row.deployment?.deploymentId,
    }));
  });
}
const retained = new WeakMap<JourneyWorld, Awaited<ReturnType<typeof journal>>>();
When(
  'I preview a sanitized conversation and retain a failed share upload',
  async function (this: JourneyWorld) {
    await ready(this);
    this.cloud.changeSession('history-a', (doc) => {
      const user = doc.getList('history').get(0);
      assert.ok(user instanceof LoroMap);
      const input = user.get('inputConfig');
      assert.ok(input instanceof LoroMap);
      input.set('browserCredential', 'controlled-browser-token');
      input.set('workspaceCredential', 'controlled.convex.jwt');
    });
    await openShare(this);
    await this.page.getByRole('button', { name: '预览分享内容', exact: true }).click();
    await expect(
      this.page.getByRole('button', { name: '发布公开链接', exact: true }),
    ).toBeEnabled();
    await this.evidence.check('frozen-preview-before-publication', async () => {
      await expect(this.page.getByRole('region', { name: '公开内容预览' })).toBeVisible();
      await expect(this.page.getByRole('region', { name: '公开内容预览' })).toContainText(
        'Previously asked question',
      );
      expect(
        this.cloud.sharing.requests.filter((request) => request.path.endsWith(':beginDeployment')),
      ).toHaveLength(0);
      expect(await journal(this)).toHaveLength(1);
    });
    this.cloud.changeSession('history-a', (doc) => {
      const user = doc.getList('history').get(0);
      assert.ok(user instanceof LoroMap);
      const input = user.get('inputConfig');
      assert.ok(input instanceof LoroMap);
      input.set('prompt', 'Live changes after the fixed snapshot');
    });
    this.cloud.sharing.failNextShareUpload();
    await this.page.getByRole('button', { name: '发布公开链接', exact: true }).click();
    await expect(this.page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await expect(
      this.page.getByRole('button', { name: '继续并确认发布', exact: true }),
    ).toBeEnabled();
    const pending = await journal(this);
    assert.equal(pending.length, 1);
    retained.set(this, pending);
    this.assertions = async () => {
      expect(this.cloud.sharing.getSharePublication()).toHaveLength(1);
      expect(this.cloud.sharing.getSharePublication()[0]!.view.status).toBe('draft');
      expect(pending[0]!.deploymentId).toBeTruthy();
    };
  },
);
When(
  'I recover the frozen publication, reset its link and revoke public access',
  async function (this: JourneyWorld) {
    await this.page.reload();
    await restored(this.page);
    await openShare(this);
    await expect(
      this.page.getByRole('button', { name: '继续并确认发布', exact: true }),
    ).toBeEnabled();
    await this.evidence.check('same-bytes-secrets-and-request-on-resume', async () => {
      expect(await journal(this)).toEqual(retained.get(this));
    });
    this.cloud.sharing.restoreShare();
    await this.page.getByRole('button', { name: '继续并确认发布', exact: true }).click();
    const linkInput = this.page.getByRole('textbox', { name: '公开分享链接' });
    await expect(linkInput).toBeVisible();
    const oldLink = await linkInput.inputValue();
    const publication = this.cloud.sharing.getSharePublication()[0]!;
    await this.evidence.check('workspace-credentials-excluded-from-public-data', async () => {
      const content = Array.from(publication.objects.values(), (bytes) =>
        bytes.toString('utf8'),
      ).join('\n');
      expect(content).not.toContain('controlled-browser-token');
      expect(content).not.toContain('controlled.convex.jwt');
      expect(content).not.toContain(retained.get(this)![0]!.uploadSecret);
      expect(content).not.toContain(retained.get(this)![0]!.readerSecret);
      expect(content).toContain('Previously asked question');
      expect(content).not.toContain('Live changes after the fixed snapshot');
    });
    await this.evidence.check('publication-confirmed-by-authority', async () => {
      expect(publication.view.status).toBe('active');
      expect(publication.view.currentDeploymentId).toBe(retained.get(this)![0]!.deploymentId);
      expect(this.cloud.sharing.getSharePublication()).toHaveLength(1);
      expect(await journal(this)).toHaveLength(0);
      expect(oldLink).toContain('#access=v1.');
      expect(this.cloud.sharing.requests.at(-1)!.path).toBe('sessionSharing:getManagement');
    });
    this.cloud.sharing.failNextShareResetConfirmation();
    await this.page.getByRole('button', { name: '重置链接', exact: true }).click();
    await this.page.getByRole('button', { name: '确认重置链接', exact: true }).click();
    await expect(
      this.page.getByRole('button', { name: '继续确认链接重置', exact: true }),
    ).toBeEnabled();
    await this.page.reload();
    await restored(this.page);
    await openShare(this);
    await this.page.getByRole('button', { name: '继续确认链接重置', exact: true }).click();
    await expect(linkInput).toBeVisible();
    const newLink = await linkInput.inputValue();
    expect(newLink).not.toBe(oldLink);
    expect(
      this.cloud.sharing.requests.filter((request) => request.path.endsWith(':resetCredential')),
    ).toHaveLength(1);
    await this.page.getByRole('button', { name: '撤销分享', exact: true }).click();
    await this.page.getByRole('button', { name: '确认撤销分享', exact: true }).click();
    this.assertions = () =>
      this.evidence.check('revocation-confirmed-by-authority', async () => {
        await expect(
          this.page.getByText('分享已撤销，原链接不再提供内容。', { exact: true }),
        ).toBeVisible();
        expect(this.cloud.sharing.getSharePublication()[0]!.view.status).toBe('revoked');
        await expect(linkInput).toHaveCount(0);
        expect(this.cloud.sharing.requests.at(-1)!.path).toBe('sessionSharing:getManagement');
        const publicStatus = await this.page.evaluate(
          async ({ origin, shareId, secret }) => {
            const response = await fetch(`${origin}/api/shares/${shareId}`, {
              headers: { authorization: `Bearer ${secret}` },
              credentials: 'omit',
              cache: 'no-store',
              redirect: 'error',
              referrerPolicy: 'no-referrer',
            });
            return response.status;
          },
          {
            origin: this.cloud.sharing.origin,
            shareId: publication.view.shareId,
            secret: new URL(newLink).hash.slice('#access=v1.'.length),
          },
        );
        expect(publicStatus).toBe(404);
        expect(
          (await new AxeBuilder({ page: this.page }).withTags(['wcag2a', 'wcag2aa']).analyze())
            .violations,
        ).toEqual([]);
      });
  },
);
