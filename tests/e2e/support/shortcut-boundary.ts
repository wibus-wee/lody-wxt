import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';

import type { BrowserContext, Route } from '@playwright/test';
import * as v from 'valibot';

const requireSdk = createRequire(
  new URL('../../../packages/lody-sdk/package.json', import.meta.url),
);
const { Flock } = requireSdk(
  '@loro-dev/flock-wasm',
) as typeof import('../../../packages/lody-sdk/node_modules/@loro-dev/flock-wasm/nodejs/index');
const { LoroDoc } = requireSdk(
  'loro-crdt',
) as typeof import('../../../packages/lody-sdk/node_modules/loro-crdt');
const identifier = v.pipe(v.string(), v.regex(/^[\w-]{1,100}$/));
const slugPattern = /^[a-z0-9][a-z0-9-]{0,39}$/;
const bearerPattern = /^Bearer /;
const visibility = v.picklist(['private', 'workspace']);
const workspace = v.literal('workspace-a');
const envelope = v.object({
  path: v.string(),
  args: v.record(v.string(), v.unknown()),
  format: v.literal('json'),
});
const stageSchema = v.strictObject({
  workspaceId: workspace,
  ownerUserId: v.literal('user-a'),
  shortcutId: identifier,
  bodyDocId: identifier,
  visibility,
});
const identitySchema = v.strictObject({
  workspaceId: workspace,
  shortcutId: identifier,
  bodyDocId: identifier,
  visibility,
});
const contentSchema = v.looseObject({
  v: v.literal(1),
  id: identifier,
  workspaceId: workspace,
  ownerUserId: identifier,
  visibility,
  name: v.string(),
  slug: v.string(),
  prompt: v.string(),
  revision: identifier,
  createdAt: v.number(),
  updatedAt: v.number(),
  mentions: v.array(v.unknown()),
  scope: v.record(v.string(), v.unknown()),
});
type Content = v.InferOutput<typeof contentSchema>;
interface Registration {
  workspaceId: string;
  ownerUserId: string;
  shortcutId: string;
  bodyDocId: string;
  visibility: 'private' | 'workspace';
  status: 'active' | 'staged' | 'revoked' | 'cancelled';
  publication?: { revision: string; slug: string; indexBytes: number };
}
const indexId = (owner: string, access: Registration['visibility']) =>
  `shortcut-index:workspace-a:${owner}:${access}`;
const bodyId = (id: string) => `shortcut-body:${id}`;

/** Real CRDT bytes at the Convex/Streams boundary, following promptShortcuts.ts. */
export class ShortcutBoundary {
  readonly requests: { operation: string; args: Record<string, unknown> }[] = [];
  readonly traffic: { stream: string; method: string; token: string; write: boolean }[] = [];
  readonly denied: { stream: string; token: string }[] = [];
  private registrations = new Map<string, Registration>();
  private bodies = new Map<string, InstanceType<typeof LoroDoc>>();
  private indexes = new Map<string, InstanceType<typeof Flock>>();
  private grants = new Map<string, { stream: string; write: boolean }>();
  private updates = new Map<string, { offset: number; bytes: Uint8Array }[]>();

  constructor() {
    this.seed(
      'desktop-private',
      'user-a',
      'private',
      'Desktop 私有检查',
      'desktop-private',
      '检查这个页面，并给出下一步。',
    );
    this.seed(
      'desktop-shared',
      'user-b',
      'workspace',
      '团队共享摘要',
      'team-summary',
      '用三句话总结页面，并标注来源。',
    );
    this.seed(
      'other-private',
      'user-b',
      'private',
      '其他成员的私有内容',
      'other-private',
      'PRIVATE CONTENT MUST NOT LEAK',
    );
  }

  private index(stream: string) {
    let flock = this.indexes.get(stream);
    if (!flock) {
      flock = new Flock();
      this.indexes.set(stream, flock);
    }
    return flock;
  }

  private seed(
    id: string,
    ownerUserId: string,
    access: Registration['visibility'],
    name: string,
    slug: string,
    prompt: string,
  ) {
    const value: Content = {
      v: 1,
      id,
      workspaceId: 'workspace-a',
      ownerUserId,
      visibility: access,
      name,
      slug,
      prompt,
      mentions: [],
      scope: {},
      revision: `${id}-r1`,
      createdAt: 1,
      updatedAt: 1,
    };
    this.publishFromDesktop(value, `${id}-body`);
  }

  /** External Desktop writer, not an SDK or browser implementation substitute. */
  publishFromDesktop(value: Content, documentId: string) {
    const document = new LoroDoc();
    document.getMap('contents').set(value.revision, JSON.parse(JSON.stringify(value)));
    document.getMap('revisions').set(value.revision, { parents: [] });
    document.commit();
    this.bodies.set(bodyId(documentId), document);
    const { prompt: _prompt, mentions: _mentions, ...summary } = value;
    const targets = value.mentions.map(
      (mention) => v.parse(v.object({ target: v.record(v.string(), v.unknown()) }), mention).target,
    );
    const entry = { ...summary, bodyDocId: documentId, dependencySummary: targets };
    for (const registration of this.registrations.values()) {
      if (registration.shortcutId === value.id && registration.status === 'active')
        registration.status = 'revoked';
    }
    this.registrations.set(documentId, {
      workspaceId: value.workspaceId,
      ownerUserId: value.ownerUserId,
      shortcutId: value.id,
      bodyDocId: documentId,
      visibility: value.visibility,
      status: 'active',
      publication: {
        revision: value.revision,
        slug: value.slug,
        indexBytes: Buffer.byteLength(JSON.stringify(entry)),
      },
    });
    const stream = indexId(value.ownerUserId, value.visibility);
    const flock = this.index(stream);
    const version = flock.version();
    flock.set(['promptShortcut', value.id], JSON.parse(JSON.stringify({ kind: 'active', entry })));
    flock.commit();
    this.record(stream, Buffer.from(JSON.stringify(flock.exportJson(version))));
  }

  active() {
    return [...this.registrations.values()].filter((row) => row.status === 'active');
  }

  content(id: string): Content {
    const row = this.active().find((entry) => entry.shortcutId === id);
    assert.ok(row?.publication, 'Shortcut has an active publication');
    return v.parse(
      contentSchema,
      this.bodies.get(bodyId(row.bodyDocId))?.getMap('contents').get(row.publication.revision),
    );
  }

  indexEntry(id: string) {
    const row = this.active().find((entry) => entry.shortcutId === id);
    assert.ok(row);
    return this.index(indexId(row.ownerUserId, row.visibility)).get(['promptShortcut', id]);
  }

  private record(stream: string, bytes: Uint8Array) {
    const rows = this.updates.get(stream) ?? [];
    rows.push({ offset: (rows.at(-1)?.offset ?? 100) + 1, bytes });
    this.updates.set(stream, rows);
  }

  private offset(stream: string) {
    return this.updates.get(stream)?.at(-1)?.offset ?? 100;
  }

  private async control(route: Route) {
    const request = route.request();
    const input = v.parse(envelope, request.postDataJSON());
    if (!input.path.startsWith('promptShortcuts:')) {
      await route.fallback();
      return;
    }
    assert.equal(request.headers().authorization, 'Bearer controlled.convex.jwt');
    const operation = input.path.slice('promptShortcuts:'.length);
    assert.equal(
      new URL(request.url()).pathname,
      operation === 'listAccessibleDocuments'
        ? '/api/query'
        : operation === 'getStreamToken'
          ? '/api/action'
          : '/api/mutation',
    );
    this.requests.push({ operation, args: structuredClone(input.args) });
    const success = (value: object | string | null) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', value }),
      });
    const forbidden = () =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ status: 'error', errorMessage: 'Forbidden shortcut resource' }),
      });
    if (operation === 'listAccessibleDocuments') {
      v.parse(v.strictObject({ workspaceId: workspace }), input.args);
      const rows = this.active().filter(
        (row) => row.ownerUserId === 'user-a' || row.visibility === 'workspace',
      );
      const deleted = [
        ...new Map(
          [...this.registrations.values()]
            .filter(
              (row) =>
                row.ownerUserId === 'user-a' &&
                row.status === 'revoked' &&
                ![...this.registrations.values()].some(
                  (active) =>
                    active.shortcutId === row.shortcutId &&
                    new Set(['active', 'staged']).has(active.status),
                ),
            )
            .map((row) => [row.shortcutId, row]),
        ).values(),
      ];
      await success(
        [...rows, ...deleted].map((row) => ({
          shortcutId: row.shortcutId,
          bodyDocId: row.bodyDocId,
          ownerUserId: row.ownerUserId,
          visibility: row.visibility,
          revision: row.publication?.revision ?? null,
          ...(row.status === 'revoked' ? { deleted: true } : {}),
        })),
      );
      return;
    }
    if (operation === 'getStreamToken') {
      const args = v.parse(
        v.strictObject({
          workspaceId: workspace,
          target: v.variant('kind', [
            v.strictObject({ kind: v.literal('index'), ownerUserId: identifier, visibility }),
            v.strictObject({ kind: v.literal('body'), bodyDocId: identifier }),
          ]),
          write: v.boolean(),
        }),
        input.args,
      );
      let stream: string;
      if (args.target.kind === 'index') {
        if (
          args.target.ownerUserId !== 'user-a' &&
          (args.write || args.target.visibility === 'private')
        ) {
          await forbidden();
          return;
        }
        stream = indexId(args.target.ownerUserId, args.target.visibility);
        this.index(stream);
      } else {
        const row = this.registrations.get(args.target.bodyDocId);
        if (
          !row ||
          !new Set(['active', 'staged']).has(row.status) ||
          (row.ownerUserId !== 'user-a' &&
            (args.write || row.visibility === 'private' || row.status === 'staged')) ||
          (args.write && row.status === 'active')
        ) {
          await forbidden();
          return;
        }
        stream = bodyId(row.bodyDocId);
        if (!this.bodies.has(stream)) this.bodies.set(stream, new LoroDoc());
      }
      const token = `shortcut-grant-${this.grants.size + 1}`;
      this.grants.set(token, { stream, write: args.write });
      await success({
        token,
        expiresIn: 3600,
        gatewayBaseUrl: 'https://api.lody.ai',
        streamId: stream,
      });
      return;
    }
    if (operation === 'stageDocument') {
      const args = v.parse(stageSchema, input.args);
      const old = this.registrations.get(args.bodyDocId);
      if (old) {
        assert.deepEqual(
          {
            workspaceId: old.workspaceId,
            ownerUserId: old.ownerUserId,
            shortcutId: old.shortcutId,
            bodyDocId: old.bodyDocId,
            visibility: old.visibility,
          },
          args,
        );
        assert.ok(new Set(['active', 'staged']).has(old.status));
      } else {
        const previous = [...this.registrations.values()].filter(
          (row) => row.shortcutId === args.shortcutId,
        );
        assert.ok(previous.every((row) => row.ownerUserId === 'user-a'));
        assert.ok(
          !previous.some((row) => row.status === 'revoked') ||
            previous.some((row) => new Set(['active', 'staged']).has(row.status)),
          'Deletion cannot be resurrected',
        );
        this.registrations.set(args.bodyDocId, { ...args, status: 'staged' });
      }
      await success({ bodyDocId: args.bodyDocId, status: old?.status ?? 'staged' });
      return;
    }
    if (operation === 'activateDocument') {
      const args = v.parse(
        v.strictObject({
          workspaceId: workspace,
          bodyDocId: identifier,
          previousBodyDocId: v.nullable(identifier),
          previousRevision: v.nullable(identifier),
          revision: identifier,
          slug: v.pipe(v.string(), v.regex(slugPattern)),
          indexBytes: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(8192)),
        }),
        input.args,
      );
      const row = this.registrations.get(args.bodyDocId);
      assert.ok(row && row.ownerUserId === 'user-a');
      const value = v.parse(
        contentSchema,
        this.bodies.get(bodyId(args.bodyDocId))?.getMap('contents').get(args.revision),
      );
      assert.equal(value.id, row.shortcutId);
      assert.equal(value.visibility, row.visibility);
      assert.equal(value.slug, args.slug);
      if (row.status === 'active') {
        assert.equal(row.publication?.revision, args.revision);
        await success(null);
        return;
      }
      assert.equal(row.status, 'staged');
      const previous = this.active().find((entry) => entry.shortcutId === row.shortcutId);
      assert.equal(
        previous?.bodyDocId ?? null,
        args.previousBodyDocId,
        'Publication CAS uses the active body',
      );
      assert.equal(
        previous?.publication?.revision ?? null,
        args.previousRevision,
        'Publication CAS uses the active revision',
      );
      if (previous) previous.status = 'revoked';
      row.status = 'active';
      row.publication = { revision: args.revision, slug: args.slug, indexBytes: args.indexBytes };
      await success(null);
      return;
    }
    if (new Set(['revokeShortcut', 'settleDocument']).has(operation)) {
      const args = v.parse(identitySchema, input.args);
      const versions = [...this.registrations.values()].filter(
        (row) => row.shortcutId === args.shortcutId,
      );
      if (versions.some((row) => row.ownerUserId !== 'user-a')) {
        await forbidden();
        return;
      }
      if (operation === 'revokeShortcut') {
        for (const row of versions) row.status = 'revoked';
        if (!versions.length)
          this.registrations.set(args.bodyDocId, {
            ...args,
            ownerUserId: 'user-a',
            status: 'revoked',
          });
        await success(null);
      } else {
        const row = this.registrations.get(args.bodyDocId);
        if (row?.status === 'active') {
          await success('active');
          return;
        }
        assert.notEqual(row?.status, 'revoked');
        this.registrations.set(args.bodyDocId, {
          ...args,
          ownerUserId: 'user-a',
          status: 'cancelled',
        });
        await success('cancelled');
      }
      return;
    }
    throw new Error(`Unexpected shortcut operation: ${operation}`);
  }

  private async streams(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const stream = decodeURIComponent(url.pathname.split('/')[3] ?? '');
    if (!stream.startsWith('shortcut-')) {
      await route.fallback();
      return;
    }
    const token = request.headers().authorization?.replace(bearerPattern, '') ?? '';
    const grant = this.grants.get(token);
    const writing = new Set(['POST', 'PUT', 'DELETE']).has(request.method());
    if (!grant || grant.stream !== stream || (writing && !grant.write)) {
      this.denied.push({ stream, token });
      await route.fulfill({ status: 403, body: 'Exact shortcut resource grant required' });
      return;
    }
    this.traffic.push({ stream, method: request.method(), token, write: grant.write });
    const snapshot = () =>
      stream.startsWith('shortcut-body:')
        ? this.bodies.get(stream)!.export({ mode: 'snapshot' })
        : this.index(stream).exportFile();
    const headers = {
      'access-control-expose-headers':
        'Stream-Next-Offset, Stream-Snapshot-Offset, Stream-Up-To-Date, Stream-Sse-Data-Encoding',
      'stream-next-offset': String(this.offset(stream)),
      'stream-up-to-date': 'true',
    };
    if (url.pathname.endsWith('/bootstrap')) {
      await route.fulfill({
        status: 200,
        headers: {
          ...headers,
          'content-type': 'multipart/mixed; boundary=shortcut-test',
          'stream-snapshot-offset': String(this.offset(stream)),
        },
        body: Buffer.concat([
          Buffer.from('--shortcut-test\r\nContent-Type: application/octet-stream\r\n\r\n'),
          Buffer.from(snapshot()),
          Buffer.from('\r\n--shortcut-test--\r\n'),
        ]),
      });
      return;
    }
    if (request.method() === 'POST') {
      const buffer = request.postDataBuffer();
      assert.ok(buffer);
      for (let cursor = 0; cursor < buffer.length;) {
        const size = buffer.readUInt32BE(cursor);
        cursor += 4;
        assert.ok(cursor + size <= buffer.length);
        const bytes = buffer.subarray(cursor, cursor + size);
        cursor += size;
        if (stream.startsWith('shortcut-body:')) this.bodies.get(stream)!.import(bytes);
        else this.index(stream).importJson(JSON.parse(bytes.toString()));
        this.record(stream, bytes);
      }
      await route.fulfill({
        status: 200,
        headers: { ...headers, 'stream-next-offset': String(this.offset(stream)) },
        body: '',
      });
      return;
    }
    if (request.method() === 'GET') {
      const offset =
        url.searchParams.get('offset') === 'now'
          ? this.offset(stream)
          : Number(url.searchParams.get('offset') ?? 100);
      if (url.searchParams.get('live') === 'sse') {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const events = (this.updates.get(stream) ?? [])
          .filter((row) => row.offset > offset)
          .map((row) => `event: data\ndata: ${Buffer.from(row.bytes).toString('base64')}\n\n`)
          .join('');
        await route.fulfill({
          status: 200,
          headers: {
            ...headers,
            'content-type': 'text/event-stream',
            'stream-sse-data-encoding': 'base64',
          },
          body: `${events}event: control\ndata: ${JSON.stringify({ streamNextOffset: String(this.offset(stream)), upToDate: true })}\n\n`,
        });
      } else {
        const frames = (this.updates.get(stream) ?? [])
          .filter((row) => row.offset > offset)
          .map(({ bytes }) => {
            const length = Buffer.alloc(4);
            length.writeUInt32BE(bytes.length);
            return Buffer.concat([length, Buffer.from(bytes)]);
          });
        await route.fulfill({
          status: 200,
          headers: { ...headers, 'content-type': 'application/octet-stream' },
          body: Buffer.concat(frames),
        });
      }
      return;
    }
    assert.ok(new Set(['HEAD', 'PUT']).has(request.method()));
    await route.fulfill({
      status: 200,
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      body: '',
    });
  }

  async install(context: BrowserContext) {
    await context.route('https://convex.lody.ai/api/{query,mutation,action}', (route) =>
      this.control(route),
    );
    await context.route('https://api.lody.ai/**', (route) => this.streams(route));
  }
}
