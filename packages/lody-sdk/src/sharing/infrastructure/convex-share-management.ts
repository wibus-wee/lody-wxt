import * as v from 'valibot';

import type { ShareManagementPort } from '../application/ports.js';
import type { BeginShareDeployment, ShareRequestOptions } from '../domain/models.js';
import { assertShareAttachmentPolicy, SharePackageManifestSchema } from './share-package.js';

const jwtPattern = /^[\w-]+\.[\w-]+\.[\w-]+$/;
const id = v.pipe(v.string(), v.minLength(1));
const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const view = v.object({
  shareId: id,
  rootSessionId: id,
  publisherUserId: id,
  status: v.picklist(['draft', 'active', 'revoked']),
  revision: count,
  credentialVersion: v.pipe(count, v.minValue(1)),
  currentDeploymentId: v.exactOptional(id),
  title: v.string(),
  createdAt: count,
  updatedAt: count,
});
const sourceIds = v.array(v.object({ sourceId: id, conversationId: id }));
const management = v.nullable(
  v.object({
    ...view.entries,
    sourceIds,
    selectedSourceIds: v.array(id),
    canManage: v.boolean(),
    canRevoke: v.boolean(),
  }),
);
const published = v.object({
  ...view.entries,
  status: v.picklist(['active', 'revoked']),
  totalBytes: count,
  conversationCount: count,
  canManage: v.boolean(),
  canRevoke: v.boolean(),
});
const hash = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/));
const revisionInput = v.strictObject({ shareId: id, expectedRevision: count });
const envelope = v.variant('status', [
  v.object({ status: v.literal('success'), value: v.unknown() }),
  v.object({ status: v.literal('error'), errorMessage: v.string() }),
]);

export interface ConvexShareManagementOptions {
  origin: string;
  getJwt: (signal: AbortSignal) => Promise<string>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}
export class ConvexShareManagement implements ShareManagementPort {
  private readonly origin: string;
  constructor(private readonly options: ConvexShareManagementOptions) {
    const url = new URL(options.origin);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid share management origin');
    this.origin = url.origin;
  }
  private async request(
    kind: 'query' | 'mutation',
    path: string,
    args: Record<string, unknown>,
    options: ShareRequestOptions = {},
  ): Promise<unknown> {
    const timeout = options.timeoutMs ?? this.options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('Invalid share timeout');
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(options.signal ? [options.signal] : []),
    ]);
    signal.throwIfAborted();
    const jwt = v.parse(v.pipe(v.string(), v.regex(jwtPattern)), await this.options.getJwt(signal));
    signal.throwIfAborted();
    const response = await (this.options.fetch ?? globalThis.fetch)(`${this.origin}/api/${kind}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `sessionSharing:${path}`, args, format: 'json' }),
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Share management failed: HTTP ${response.status}`);
    }
    const result = v.parse(envelope, await response.json());
    signal.throwIfAborted();
    if (result.status !== 'success')
      throw new Error(`Share management failed: ${result.errorMessage}`);
    return result.value;
  }
  list = async (
    workspaceId: string,
    pagination: { numItems: number; cursor: string | null },
    options?: ShareRequestOptions,
  ) =>
    v.parse(
      v.object({ page: v.array(published), isDone: v.boolean(), continueCursor: v.string() }),
      await this.request(
        'query',
        'list',
        {
          workspaceId: v.parse(id, workspaceId),
          paginationOpts: v.parse(
            v.object({
              numItems: v.pipe(count, v.minValue(1), v.maxValue(100)),
              cursor: v.nullable(v.string()),
            }),
            pagination,
          ),
        },
        options,
      ),
    );
  getManagement = async (
    workspaceId: string,
    rootSessionId: string,
    shareId?: string,
    options?: ShareRequestOptions,
  ) => {
    const result = v.parse(
      management,
      await this.request(
        'query',
        'getManagement',
        {
          workspaceId: v.parse(id, workspaceId),
          rootSessionId: v.parse(id, rootSessionId),
          ...(shareId ? { shareId: v.parse(id, shareId) } : {}),
        },
        options,
      ),
    );
    if (
      result &&
      (result.rootSessionId !== rootSessionId || (shareId && result.shareId !== shareId))
    )
      throw new Error('Share identity mismatch');
    return result;
  };
  beginDeployment = async (input: BeginShareDeployment, options?: ShareRequestOptions) => {
    const manifest = SharePackageManifestSchema.parse(input.manifest);
    assertShareAttachmentPolicy(manifest);
    const args = v.parse(
      v.strictObject({
        workspaceId: id,
        rootSessionId: id,
        shareId: v.exactOptional(id),
        expectedRevision: v.exactOptional(count),
        credentialHash: v.exactOptional(hash),
        uploadCredentialHash: hash,
        requestId: id,
        manifest: v.unknown(),
        sourceIds,
      }),
      { ...input, manifest },
    );
    const result = v.parse(
      v.object({ ...view.entries, deploymentId: id }),
      await this.request('mutation', 'beginDeployment', args, options),
    );
    if (
      result.rootSessionId !== input.rootSessionId ||
      (input.shareId && result.shareId !== input.shareId)
    )
      throw new Error('Share identity mismatch');
    return result;
  };
  publishDeployment = async (deploymentId: string, options?: ShareRequestOptions) => {
    const result = v.parse(
      view,
      await this.request(
        'mutation',
        'publishDeployment',
        { deploymentId: v.parse(id, deploymentId) },
        options,
      ),
    );
    if (result.status !== 'active' || result.currentDeploymentId !== deploymentId)
      throw new Error('Share publication was not confirmed');
    return result;
  };
  resetCredential = async (
    input: { shareId: string; expectedRevision: number; credentialHash: string },
    options?: ShareRequestOptions,
  ) => {
    const result = v.parse(
      view,
      await this.request(
        'mutation',
        'resetCredential',
        v.parse(v.strictObject({ ...revisionInput.entries, credentialHash: hash }), input),
        options,
      ),
    );
    if (result.shareId !== input.shareId) throw new Error('Share identity mismatch');
    return result;
  };
  revoke = async (
    input: { shareId: string; expectedRevision: number },
    options?: ShareRequestOptions,
  ) => {
    const result = v.parse(
      view,
      await this.request('mutation', 'revoke', v.parse(revisionInput, input), options),
    );
    if (result.shareId !== input.shareId || result.status !== 'revoked')
      throw new Error('Share revocation was not confirmed');
    return result;
  };
}
