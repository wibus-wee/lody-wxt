import * as v from 'valibot';

import type { ShortcutCloudPort, ShortcutRequestOptions } from '../application/ports.js';
import { getShortcutBodyStreamId, getShortcutIndexStreamId } from '../domain/access.js';
import type {
  PromptShortcutIndexEntry,
  ShortcutLocalRecord,
  ShortcutResource,
} from '../domain/models.js';
import { PromptShortcutError, shortcutByteLength } from '../domain/models.js';
import { parseShortcutIndex } from './catalog.js';
import {
  directoryEntrySchema,
  localRecordSchema,
  shortcutOrigin,
  shortcutResourceSchema,
  validateShortcutGrant,
} from './schemas.js';

const envelope = v.variant('status', [
  v.object({ status: v.literal('success'), value: v.unknown() }),
  v.object({ status: v.literal('error'), errorMessage: v.string() }),
]);
const tokenSchema = v.pipe(v.string(), v.regex(/^[^.\s]+\.[^.\s]+\.[^.\s]+$/));
const identitySchema = v.pipe(v.string(), v.minLength(1), v.maxLength(200));
export interface ConvexPromptShortcutsOptions {
  origin: string;
  workspaceId: string;
  userId: string;
  getJwt: (signal: AbortSignal) => Promise<string>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** Authenticated directory and resource grants; the host binds credentials to the active identity. */
export class ConvexPromptShortcuts implements ShortcutCloudPort {
  private readonly origin: string;
  constructor(private readonly options: ConvexPromptShortcutsOptions) {
    this.origin = shortcutOrigin(options.origin);
    v.parse(identitySchema, options.workspaceId);
    v.parse(identitySchema, options.userId);
  }
  private async request(
    kind: 'query' | 'mutation' | 'action',
    method: string,
    args: Record<string, unknown>,
    options: ShortcutRequestOptions = {},
  ) {
    const timeoutMs = v.parse(
      v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
      options.timeoutMs ?? this.options.timeoutMs ?? 30_000,
    );
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeoutMs),
      ...(options.signal ? [options.signal] : []),
    ]);
    signal.throwIfAborted();
    const jwt = v.parse(tokenSchema, await this.options.getJwt(signal));
    signal.throwIfAborted();
    const response = await (this.options.fetch ?? globalThis.fetch)(`${this.origin}/api/${kind}`, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal,
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `promptShortcuts:${method}`, args, format: 'json' }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Shortcut ${method} failed: HTTP ${response.status}`);
    }
    const result = v.parse(envelope, await response.json());
    signal.throwIfAborted();
    if (result.status === 'error') throw new Error(result.errorMessage);
    return result.value;
  }
  private own(entry: PromptShortcutIndexEntry) {
    const parsed = parseShortcutIndex(entry);
    if (
      parsed.workspaceId !== this.options.workspaceId ||
      parsed.ownerUserId !== this.options.userId
    )
      throw new PromptShortcutError('forbidden', 'Shortcut belongs to another identity');
    return parsed;
  }
  private record(record: ShortcutLocalRecord) {
    const parsed = v.parse(localRecordSchema, record);
    this.own(parsed.entry);
    if (parsed.published) {
      this.own(parsed.published);
      if (parsed.published.id !== parsed.entry.id)
        throw new PromptShortcutError('invalid_template', 'Publication identity mismatch');
    }
    return parsed;
  }
  listAccessibleDocuments = async (options?: ShortcutRequestOptions) => {
    const rows = v.parse(
      v.array(directoryEntrySchema),
      await this.request(
        'query',
        'listAccessibleDocuments',
        { workspaceId: this.options.workspaceId },
        options,
      ),
    );
    if (rows.some((row) => row.visibility === 'private' && row.ownerUserId !== this.options.userId))
      throw new PromptShortcutError(
        'forbidden',
        'Directory contains another user private resource',
      );
    if (new Set(rows.map((row) => row.shortcutId)).size !== rows.length)
      throw new PromptShortcutError('invalid_template', 'Duplicate shortcut directory identity');
    return rows;
  };
  getStreamToken = async (
    resource: ShortcutResource,
    write: boolean,
    options?: ShortcutRequestOptions,
  ) => {
    const parsed = v.parse(shortcutResourceSchema, resource);
    if (
      parsed.kind === 'index' &&
      (parsed.domain.workspaceId !== this.options.workspaceId ||
        (parsed.domain.ownerUserId !== this.options.userId &&
          (write || parsed.domain.visibility === 'private')))
    )
      throw new PromptShortcutError('forbidden', 'Shortcut index access denied');
    const target =
      parsed.kind === 'body'
        ? parsed
        : {
            kind: 'index',
            ownerUserId: parsed.domain.ownerUserId,
            visibility: parsed.domain.visibility,
          };
    const grant = validateShortcutGrant(
      await this.request(
        'action',
        'getStreamToken',
        { workspaceId: this.options.workspaceId, target, write },
        options,
      ),
    );
    const expected =
      parsed.kind === 'body'
        ? getShortcutBodyStreamId(parsed.bodyDocId)
        : getShortcutIndexStreamId(parsed.domain);
    if (grant.streamId !== expected)
      throw new PromptShortcutError('forbidden', 'Grant does not match the requested stream');
    return grant;
  };
  stage = async (record: ShortcutLocalRecord, options?: ShortcutRequestOptions) => {
    const { entry } = this.record(record);
    const result = v.parse(
      v.object({ bodyDocId: identitySchema, status: v.picklist(['staged', 'active']) }),
      await this.request(
        'mutation',
        'stageDocument',
        {
          workspaceId: this.options.workspaceId,
          ownerUserId: this.options.userId,
          shortcutId: entry.id,
          bodyDocId: entry.bodyDocId,
          visibility: entry.visibility,
        },
        options,
      ),
    );
    if (result.bodyDocId !== entry.bodyDocId)
      throw new PromptShortcutError('invalid_template', 'Stage reply changed body identity');
    return result.status;
  };
  activate = async (record: ShortcutLocalRecord, options?: ShortcutRequestOptions) => {
    const { entry, published } = this.record(record);
    v.parse(
      v.null(),
      await this.request(
        'mutation',
        'activateDocument',
        {
          workspaceId: this.options.workspaceId,
          bodyDocId: entry.bodyDocId,
          previousBodyDocId: published?.bodyDocId ?? null,
          previousRevision: published?.revision ?? null,
          revision: entry.revision,
          slug: entry.slug,
          indexBytes: shortcutByteLength(JSON.stringify(entry)),
        },
        options,
      ),
    );
  };
  settle = async (record: ShortcutLocalRecord, options?: ShortcutRequestOptions) => {
    const { entry } = this.record(record);
    return v.parse(
      v.picklist(['active', 'cancelled']),
      await this.request(
        'mutation',
        'settleDocument',
        {
          workspaceId: this.options.workspaceId,
          shortcutId: entry.id,
          bodyDocId: entry.bodyDocId,
          visibility: entry.visibility,
        },
        options,
      ),
    );
  };
  revoke = async (input: PromptShortcutIndexEntry, options?: ShortcutRequestOptions) => {
    const entry = this.own(input);
    v.parse(
      v.null(),
      await this.request(
        'mutation',
        'revokeShortcut',
        {
          workspaceId: this.options.workspaceId,
          shortcutId: entry.id,
          bodyDocId: entry.bodyDocId,
          visibility: entry.visibility,
        },
        options,
      ),
    );
  };
}
