import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type {
  BeginShareDeployment,
  SessionShareManagementEntry,
  SessionShareView,
  SharePackageManifest,
} from '@lody-mobile/sdk';
import { validateShareManifest } from '@lody-mobile/sdk';
import type { BrowserContext, Route } from '@playwright/test';
import * as v from 'valibot';

const apiOrigin = 'https://share-api.example.test';
const id = v.pipe(v.string(), v.minLength(1));
const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const secretPattern = /^[a-f0-9]{64}$/;
const digest = v.pipe(v.string(), v.regex(secretPattern));
const envelope = v.object({
  path: v.string(),
  args: v.record(v.string(), v.unknown()),
  format: v.literal('json'),
});
const beginSchema = v.strictObject({
  workspaceId: v.literal('workspace-a'),
  rootSessionId: id,
  shareId: v.exactOptional(id),
  expectedRevision: v.exactOptional(count),
  credentialHash: v.exactOptional(digest),
  uploadCredentialHash: digest,
  requestId: id,
  manifest: v.unknown(),
  sourceIds: v.array(v.strictObject({ sourceId: id, conversationId: id })),
});
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const secretHash = (secret: string) => hash(`lody-session-share-access-v1:${secret}`);
interface Deployment {
  id: string;
  shareId: string;
  input: BeginShareDeployment;
  objects: Map<string, Buffer>;
  manifestBytes?: Buffer;
  sealed: boolean;
  published: boolean;
}
interface ShareState {
  view: SessionShareView;
  credentialHash: string;
  sourceIds: BeginShareDeployment['sourceIds'];
}

/** Protocol fixture; all publication mutations terminate inside Playwright routing. */
export class SharingBoundary {
  readonly origin = apiOrigin;
  readonly requests: { path: string; args: Record<string, unknown> }[] = [];
  readonly uploads: { deploymentId: string; objectId: string; sha256: string; size: number }[] = [];
  private shares = new Map<string, ShareState>();
  private deployments = new Map<string, Deployment>();
  private requestIds = new Map<string, string>();
  private uploadBlocked = false;
  private loseReset = false;
  private losePublish = false;
  failNextShareUpload() {
    this.uploadBlocked = true;
  }
  restoreShare() {
    this.uploadBlocked = false;
  }
  failNextShareResetConfirmation() {
    this.loseReset = true;
  }
  failNextSharePublicationConfirmation() {
    this.losePublish = true;
  }
  getSharePublication() {
    return Array.from(this.deployments.values(), (deployment) => ({
      deploymentId: deployment.id,
      input: structuredClone(deployment.input),
      sealed: deployment.sealed,
      manifestBytes: deployment.manifestBytes ? Buffer.from(deployment.manifestBytes) : null,
      objects: new Map(Array.from(deployment.objects, ([key, value]) => [key, Buffer.from(value)])),
      view: structuredClone(this.shares.get(deployment.shareId)!.view),
    }));
  }
  readShareObject(deploymentId: string, objectId: string) {
    const bytes = this.deployments.get(deploymentId)?.objects.get(objectId);
    assert.ok(bytes, 'Uploaded share object exists');
    return Buffer.from(bytes);
  }
  private async response(
    route: Route,
    value:
      | SessionShareView
      | SessionShareManagementEntry
      | null
      | { page: SessionShareManagementEntry[]; isDone: boolean; continueCursor: string },
  ) {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', value }),
    });
  }
  private management(state: ShareState): SessionShareManagementEntry {
    return {
      ...state.view,
      sourceIds: state.sourceIds,
      selectedSourceIds: state.sourceIds.map((source) => source.sourceId),
      canManage: true,
      canRevoke: true,
    };
  }
  private async control(route: Route) {
    const request = route.request();
    const body = v.parse(envelope, request.postDataJSON());
    if (!body.path.startsWith('sessionSharing:')) {
      await route.fallback();
      return;
    }
    assert.equal(request.headers().authorization, 'Bearer controlled.convex.jwt');
    const operation = body.path.slice('sessionSharing:'.length);
    assert.equal(
      new URL(request.url()).pathname,
      new Set(['list', 'getManagement']).has(operation) ? '/api/query' : '/api/mutation',
    );
    this.requests.push({ path: body.path, args: structuredClone(body.args) });
    if (operation === 'getManagement') {
      const args = v.parse(
        v.strictObject({
          workspaceId: v.literal('workspace-a'),
          rootSessionId: id,
          shareId: v.exactOptional(id),
        }),
        body.args,
      );
      const state = args.shareId
        ? this.shares.get(args.shareId)
        : [...this.shares.values()].find(
            (share) => share.view.rootSessionId === args.rootSessionId,
          );
      if (state) assert.equal(state.view.rootSessionId, args.rootSessionId);
      await this.response(route, state ? this.management(state) : null);
      return;
    }
    if (operation === 'list') {
      v.parse(
        v.strictObject({
          workspaceId: v.literal('workspace-a'),
          paginationOpts: v.object({ numItems: count, cursor: v.nullable(v.string()) }),
        }),
        body.args,
      );
      const page = [...this.shares.values()]
        .filter((state) => state.view.status !== 'draft')
        .map((state) => {
          const deployment = this.deployments.get(state.view.currentDeploymentId ?? '');
          return {
            ...this.management(state),
            totalBytes:
              deployment?.input.manifest.objects.reduce(
                (sum, object) => sum + object.sizeBytes,
                0,
              ) ?? 0,
            conversationCount: deployment?.input.manifest.conversations.length ?? 0,
          };
        });
      await this.response(route, { page, isDone: true, continueCursor: '' });
      return;
    }
    if (operation === 'beginDeployment') {
      const parsed = v.parse(beginSchema, body.args);
      const input: BeginShareDeployment = {
        ...parsed,
        manifest: validateShareManifest(parsed.manifest),
      };
      const known = this.requestIds.get(input.requestId);
      if (known) {
        const deployment = this.deployments.get(known)!;
        assert.deepEqual(
          deployment.input,
          input,
          'A retried request retains its frozen package and credentials',
        );
        await this.response(route, {
          ...this.shares.get(deployment.shareId)!.view,
          deploymentId: deployment.id,
        } as SessionShareView);
        return;
      }
      let state = input.shareId ? this.shares.get(input.shareId) : undefined;
      if (input.shareId) {
        assert.ok(state);
        assert.equal(state.view.revision, input.expectedRevision);
        assert.equal(state.view.rootSessionId, input.rootSessionId);
      } else {
        assert.ok(input.credentialHash);
        const shareId = `share-${this.shares.size + 1}`;
        state = {
          view: {
            shareId,
            rootSessionId: input.rootSessionId,
            publisherUserId: 'user-a',
            status: 'draft',
            revision: 0,
            credentialVersion: 1,
            title: input.manifest.conversations.find(
              (conversation) => conversation.id === input.manifest.rootConversationId,
            )!.title,
            createdAt: 1,
            updatedAt: 1,
          },
          credentialHash: input.credentialHash,
          sourceIds: input.sourceIds,
        };
        this.shares.set(shareId, state);
      }
      assert.ok(state);
      const deploymentId = `deployment-${this.deployments.size + 1}`;
      this.deployments.set(deploymentId, {
        id: deploymentId,
        shareId: state.view.shareId,
        input: structuredClone(input),
        objects: new Map(),
        sealed: false,
        published: false,
      });
      this.requestIds.set(input.requestId, deploymentId);
      await this.response(route, { ...state.view, deploymentId } as SessionShareView);
      return;
    }
    if (operation === 'publishDeployment') {
      const args = v.parse(v.strictObject({ deploymentId: id }), body.args);
      const deployment = this.deployments.get(args.deploymentId);
      assert.ok(deployment?.sealed, 'Only sealed deployments can be published');
      const state = this.shares.get(deployment.shareId)!;
      deployment.published = true;
      if (state.view.currentDeploymentId !== deployment.id) {
        state.view = {
          ...state.view,
          currentDeploymentId: deployment.id,
          status: 'active',
          revision: state.view.revision + 1,
          updatedAt: state.view.updatedAt + 1,
        };
        state.sourceIds = deployment.input.sourceIds;
      }
      if (this.losePublish) {
        this.losePublish = false;
        await route.fulfill({ status: 503, body: 'Publication accepted; acknowledgement lost' });
        return;
      }
      await this.response(route, state.view);
      return;
    }
    if (new Set(['resetCredential', 'revoke']).has(operation)) {
      const args =
        operation === 'resetCredential'
          ? v.parse(
              v.strictObject({ shareId: id, expectedRevision: count, credentialHash: digest }),
              body.args,
            )
          : v.parse(v.strictObject({ shareId: id, expectedRevision: count }), body.args);
      const state = this.shares.get(args.shareId);
      assert.ok(state);
      if (state.view.revision !== args.expectedRevision) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ status: 'error', errorMessage: 'revision_conflict' }),
        });
        return;
      }
      state.view = {
        ...state.view,
        revision: state.view.revision + 1,
        updatedAt: state.view.updatedAt + 1,
      };
      if (operation === 'resetCredential') {
        state.credentialHash = v.parse(digest, body.args.credentialHash);
        state.view.credentialVersion++;
      } else state.view.status = 'revoked';
      if (operation === 'resetCredential' && this.loseReset) {
        this.loseReset = false;
        await route.fulfill({ status: 503, body: 'Credential changed; acknowledgement lost' });
        return;
      }
      await this.response(route, state.view);
      return;
    }
    assert.fail(`Unhandled sharing operation ${operation}`);
  }
  private async data(route: Route) {
    const request = route.request();
    const parts = new URL(request.url()).pathname.split('/').slice(1);
    const secret = request.headers().authorization?.slice('Bearer '.length) ?? '';
    assert.match(
      secret,
      secretPattern,
      'Data plane accepts only a share capability, never account JWT',
    );
    assert.equal(request.headers().cookie, undefined);
    if (parts[1] === 'share-deployments') {
      const deployment = this.deployments.get(parts[2]!);
      assert.ok(deployment);
      assert.equal(secretHash(secret), deployment.input.uploadCredentialHash);
      if (this.uploadBlocked) {
        await route.fulfill({ status: 503, body: 'Controlled share upload interruption' });
        return;
      }
      const bytes = request.postDataBuffer();
      assert.ok(bytes);
      if (parts[3] === 'objects') {
        assert.equal(request.method(), 'PUT');
        const descriptor = deployment.input.manifest.objects.find(
          (object) => object.id === parts[4],
        );
        assert.ok(descriptor);
        assert.equal(bytes.length, descriptor.sizeBytes);
        assert.equal(hash(bytes), descriptor.sha256);
        const previous = deployment.objects.get(descriptor.id);
        if (previous)
          assert.deepEqual(previous, bytes, 'Deployment objects cannot change during recovery');
        deployment.objects.set(descriptor.id, Buffer.from(bytes));
        this.uploads.push({
          deploymentId: deployment.id,
          objectId: descriptor.id,
          sha256: hash(bytes),
          size: bytes.length,
        });
      } else {
        assert.equal(parts[3], 'seal');
        assert.equal(request.method(), 'POST');
        const manifest: SharePackageManifest = validateShareManifest(JSON.parse(bytes.toString()));
        assert.deepEqual(manifest, deployment.input.manifest);
        for (const object of manifest.objects) {
          const uploaded = deployment.objects.get(object.id);
          assert.ok(uploaded);
          assert.equal(hash(uploaded), object.sha256);
        }
        deployment.manifestBytes = Buffer.from(bytes);
        deployment.sealed = true;
      }
      await route.fulfill({ status: 204 });
      return;
    }
    assert.equal(parts[1], 'shares');
    assert.equal(request.method(), 'GET');
    const state = this.shares.get(parts[2]!);
    if (!state || state.view.status !== 'active' || secretHash(secret) !== state.credentialHash) {
      await route.fulfill({ status: 404, body: 'Share unavailable' });
      return;
    }
    const deployment = this.deployments.get(state.view.currentDeploymentId!)!;
    if (parts.length === 3) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          shareId: state.view.shareId,
          deploymentId: deployment.id,
          manifest: deployment.input.manifest,
        }),
      });
      return;
    }
    assert.equal(parts[3], 'deployments');
    assert.equal(parts[5], 'objects');
    const pinned = this.deployments.get(parts[4]!);
    if (!pinned?.published || pinned.shareId !== state.view.shareId) {
      await route.fulfill({ status: 404, body: 'Share unavailable' });
      return;
    }
    const bytes = pinned.objects.get(parts[6]!);
    assert.ok(bytes);
    await route.fulfill({ contentType: 'application/octet-stream', body: bytes });
  }
  async install(context: BrowserContext) {
    await context.route('https://convex.lody.ai/api/{query,mutation}', (route) =>
      this.control(route),
    );
    await context.route(`${apiOrigin}/**`, (route) => this.data(route));
  }
}
