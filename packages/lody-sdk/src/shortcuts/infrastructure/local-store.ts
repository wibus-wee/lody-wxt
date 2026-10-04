import type { LoroRepo, RepoFlockDocLease } from 'loro-repo';
import * as v from 'valibot';

import { getShortcutBodyStreamId } from '../domain/access.js';
import { sameShortcutIndex, sameShortcutRecord } from '../domain/equality.js';
import type {
  PromptShortcut,
  PromptShortcutIndexEntry,
  ShortcutDirectoryEntry,
  ShortcutLocalRecord,
} from '../domain/models.js';
import { PromptShortcutError, shortcutByteLength } from '../domain/models.js';
import { projectShortcutIndex } from './catalog.js';
import { parsePromptShortcut } from './compiler.js';
import { PromptShortcutDocument } from './document.js';
import { discoverySchema, intentSchema, localRecordSchema as recordSchema } from './schemas.js';

/** User/workspace-local working catalog. Its pointer-only outbox NEVER joins Streams. */
export class LocalShortcutStore {
  private tail: Promise<unknown> = Promise.resolve();
  private constructor(
    readonly repo: LoroRepo,
    readonly workspaceId: string,
    readonly userId: string,
    private readonly ledger: RepoFlockDocLease,
    private readonly ledgerId: string,
  ) {}

  static async open(options: { repo: LoroRepo; workspaceId: string; userId: string }) {
    if (options.repo.hasTransport())
      throw new Error('Shortcut storage must not use workspace transports');
    const id = `shortcut-local:${encodeURIComponent(options.workspaceId)}:${encodeURIComponent(options.userId)}`;
    const store = new LocalShortcutStore(
      options.repo,
      options.workspaceId,
      options.userId,
      await options.repo.acquireFlockDoc(id),
      id,
    );
    try {
      await store.recover();
      await store.upgradePublicationProtocol();
      return store;
    } catch (error) {
      await store.dispose();
      throw error;
    }
  }

  private serialized<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private assertOwner(entry: Pick<PromptShortcut, 'workspaceId' | 'ownerUserId'>) {
    if (entry.workspaceId !== this.workspaceId || entry.ownerUserId !== this.userId)
      throw new PromptShortcutError('forbidden', 'Shortcut belongs to another identity');
  }

  get(id: string): ShortcutLocalRecord | null {
    const value = this.ledger.flock.get(['shortcut', id]);
    if (value == null) return null;
    const row = v.parse(recordSchema, value);
    this.assertOwner(row.entry);
    if (row.entry.id !== id)
      throw new PromptShortcutError('invalid_template', 'Outbox key mismatch');
    if (row.published) {
      this.assertOwner(row.published);
      if (row.published.id !== id)
        throw new PromptShortcutError('invalid_template', 'Publication identity mismatch');
    }
    return row;
  }

  list(): ShortcutLocalRecord[] {
    return [...this.ledger.flock.scan({ prefix: ['shortcut'] })].flatMap((row) => {
      if (row.value === undefined || !v.is(v.string(), row.key[1])) return [];
      const record = this.get(row.key[1]);
      return record ? [record] : [];
    });
  }

  discovery(): v.InferOutput<typeof discoverySchema> {
    return v.parse(
      discoverySchema,
      this.ledger.flock.get(['discovery']) ?? { directory: [], entries: [] },
    );
  }

  applyRemoteDeletions(rows: readonly ShortcutDirectoryEntry[]): Promise<void> {
    return this.serialized(async () => {
      await this.recover();
      for (const row of rows) {
        if (!row.deleted || row.ownerUserId !== this.userId) continue;
        const current = this.get(row.shortcutId);
        // Never erase offline edits because a different device deleted the source.
        if (!current || current.operation || current.deleted) continue;
        await this.put({ ...current, deleted: true, published: null });
      }
    });
  }

  cacheDiscovery(discovery: v.InferOutput<typeof discoverySchema>): Promise<void> {
    return this.serialized(async () => {
      const value = v.parse(discoverySchema, discovery);
      if (value.entries.some((entry) => entry.workspaceId !== this.workspaceId))
        throw new PromptShortcutError('forbidden', 'Wrong workspace');
      this.ledger.flock.set(['discovery'], JSON.parse(JSON.stringify(value)));
      this.ledger.flock.commit();
      await this.repo.persistFlockDocNow(this.ledgerId, this.ledger.flock);
    });
  }

  publication(id: string): ShortcutLocalRecord | null {
    const value = this.ledger.flock.get(['publication', id]);
    if (value == null) return null;
    const record = v.parse(recordSchema, value);
    this.assertOwner(record.entry);
    if (record.entry.id !== id) throw new Error('Publication key mismatch');
    return record;
  }

  /** Freeze a separate, current-state-only body BEFORE any remote call. Working
   * documents never enter Streams, even while an older shared job is in flight. */
  preparePublication(id: string): Promise<ShortcutLocalRecord | null> {
    return this.serialized(async () => {
      await this.recover();
      const existing = this.publication(id);
      const current = this.get(id);
      if (existing && !current?.deleted) return existing;
      if (!current?.operation) return null;
      let record = current;
      if (current.operation === 'save') {
        const value = await this.read(current.entry);
        const bodyDocId = crypto.randomUUID();
        const docId = getShortcutBodyStreamId(bodyDocId);
        const lease = await this.repo.acquireDoc(docId);
        try {
          new PromptShortcutDocument(lease.doc).save(value, []);
          await this.repo.persistDocNow(docId, lease.doc);
        } finally {
          await lease.release();
        }
        record = { ...current, entry: projectShortcutIndex(value, bodyDocId) };
      }
      this.ledger.flock.set(['publication', id], JSON.parse(JSON.stringify(record)));
      this.ledger.flock.commit();
      await this.repo.persistFlockDocNow(this.ledgerId, this.ledger.flock);
      return record;
    });
  }

  private async put(record: ShortcutLocalRecord) {
    this.ledger.flock.set(
      ['shortcut', record.entry.id],
      JSON.parse(JSON.stringify(v.parse(recordSchema, record))),
    );
    this.ledger.flock.commit();
    await this.repo.persistFlockDocNow(this.ledgerId, this.ledger.flock);
  }

  private async clearIntent(id: string) {
    this.ledger.flock.delete(['writeIntent', id]);
    this.ledger.flock.commit();
    await this.repo.persistFlockDocNow(this.ledgerId, this.ledger.flock);
  }

  /** One-time development-schema upgrade. Preserve an ambiguous v1 job's exact
   * remote identity, but fork its working copy before allowing further edits.
   * Each row transition is atomic; interruption can safely replay the upgrade. */
  private async upgradePublicationProtocol() {
    const version = this.ledger.flock.get(['publicationProtocol']);
    if (version === 2) return;
    if (version != null) throw new Error('Unsupported Shortcut publication protocol');
    for (const record of this.list()) {
      if (record.operation !== 'save' || this.publication(record.entry.id)) continue;
      const value = await this.read(record.entry);
      const bodyDocId = crypto.randomUUID();
      const docId = getShortcutBodyStreamId(bodyDocId);
      const lease = await this.repo.acquireDoc(docId);
      try {
        new PromptShortcutDocument(lease.doc).save(value, []);
        await this.repo.persistDocNow(docId, lease.doc);
      } finally {
        await lease.release();
      }
      this.ledger.flock.set(['publication', record.entry.id], JSON.parse(JSON.stringify(record)));
      this.ledger.flock.set(
        ['shortcut', record.entry.id],
        JSON.parse(
          JSON.stringify({
            ...record,
            entry: projectShortcutIndex(value, bodyDocId),
          }),
        ),
      );
      this.ledger.flock.commit();
      await this.repo.persistFlockDocNow(this.ledgerId, this.ledger.flock);
    }
    this.ledger.flock.set(['publicationProtocol'], 2);
    this.ledger.flock.commit();
    await this.repo.persistFlockDocNow(this.ledgerId, this.ledger.flock);
  }

  /** Repair only explicitly journaled bodies. A pre-body crash discards the
   * unacknowledged intent; a post-body crash finishes the working projection. */
  private async recover() {
    for (const row of this.ledger.flock.scan({ prefix: ['writeIntent'] })) {
      if (row.value === undefined) continue;
      const parsed = v.safeParse(intentSchema, row.value);
      // v1 used the published entry as its local save base and disallowed edits
      // while pending. Read that shape only for crash recovery during the upgrade.
      const legacy = parsed.success ? null : v.parse(recordSchema, row.value);
      const { record, baseRevision } = parsed.success
        ? parsed.output
        : {
            record: legacy!,
            baseRevision: legacy!.published?.revision ?? null,
          };
      this.assertOwner(record.entry);
      if (row.key[1] !== record.entry.id)
        throw new PromptShortcutError('invalid_template', 'Intent identity mismatch');
      const lease = await this.repo.acquireDoc(getShortcutBodyStreamId(record.entry.bodyDocId));
      try {
        const saved = new PromptShortcutDocument(lease.doc).read();
        if (saved?.revision === record.entry.revision) {
          if (!sameShortcutIndex(projectShortcutIndex(saved, record.entry.bodyDocId), record.entry))
            throw new PromptShortcutError('conflict', 'Intent does not match the durable body');
          await this.put(record);
        } else if (saved && saved.revision !== baseRevision) {
          throw new PromptShortcutError('conflict', 'Body advanced beyond the interrupted save');
        }
        await this.clearIntent(record.entry.id);
      } finally {
        await lease.release();
      }
    }
  }

  /** Authorization is the runtime's responsibility, including for cached bodies. */
  async read(entry: PromptShortcutIndexEntry): Promise<PromptShortcut> {
    if (entry.workspaceId !== this.workspaceId)
      throw new PromptShortcutError('forbidden', 'Wrong workspace');
    const lease = await this.repo.acquireDoc(getShortcutBodyStreamId(entry.bodyDocId));
    try {
      const content = new PromptShortcutDocument(lease.doc).read();
      if (!content) throw new PromptShortcutError('not_found', 'Shortcut body is not available');
      if (!sameShortcutIndex(projectShortcutIndex(content, entry.bodyDocId), entry))
        throw new PromptShortcutError('revision_pending', 'Index and body have not converged');
      return content;
    } finally {
      await lease.release();
    }
  }

  save(input: {
    value: unknown;
    bodyDocId: string;
    base: PromptShortcutIndexEntry | null;
  }): Promise<ShortcutLocalRecord> {
    return this.serialized(async () => {
      await this.recover();
      const value = parsePromptShortcut(input.value);
      this.assertOwner(value);
      const current = this.get(value.id);
      if (current?.deleted) throw new PromptShortcutError('conflict', 'Shortcut was deleted');
      if (current && !input.base)
        throw new PromptShortcutError('conflict', 'Shortcut already exists');
      if (input.base) {
        this.assertOwner(input.base);
        if (input.base.id !== value.id || input.base.createdAt !== value.createdAt)
          throw new PromptShortcutError('conflict', 'Shortcut identity changed');
      }
      const adoptsRemote =
        !!current &&
        !current.operation &&
        !!input.base &&
        !sameShortcutIndex(current.entry, input.base);
      if (current && !adoptsRemote && !sameShortcutIndex(current.entry, input.base))
        throw new PromptShortcutError('conflict', 'Shortcut changed since editing started');
      const rotates = input.base !== null && input.base.visibility !== value.visibility;
      if (input.base && rotates === (input.base.bodyDocId === input.bodyDocId))
        throw new PromptShortcutError('conflict', 'Visibility changes require a fresh body');
      if (rotates || adoptsRemote) {
        // The selected source must still match before copying it to a fresh history.
        await this.read(input.base!);
      }
      // Editing an owned remote publication first forks it into local-only storage.
      // Never append local edits (or their history) to a granted body resource.
      const forkPublished =
        input.base &&
        (!current || adoptsRemote || current.entry.bodyDocId === current.published?.bodyDocId);
      const bodyDocId = forkPublished ? crypto.randomUUID() : input.bodyDocId;
      const entry = projectShortcutIndex(value, bodyDocId);
      const siblings = this.list().filter(
        (row) =>
          !row.deleted && row.entry.id !== value.id && row.entry.visibility === value.visibility,
      );
      if (siblings.some((row) => row.entry.slug === value.slug))
        throw new PromptShortcutError('conflict', 'Shortcut slug is already in use');
      if (
        siblings.length >= 100 ||
        shortcutByteLength(JSON.stringify([...siblings.map((row) => row.entry), entry])) >
          512 * 1024
      )
        throw new PromptShortcutError('size_limit', 'Shortcut catalog exceeds its quota');
      const docId = getShortcutBodyStreamId(bodyDocId);
      const lease = await this.repo.acquireDoc(docId);
      const record: ShortcutLocalRecord = {
        entry,
        published: adoptsRemote
          ? input.base
          : (current?.published ?? (current ? null : input.base)),
        operation: 'save',
        deleted: false,
      };
      try {
        const document = new PromptShortcutDocument(lease.doc);
        const parents = !current || rotates || forkPublished ? [] : [current.entry.revision];
        document.validateSave(value, parents);
        this.ledger.flock.set(
          ['writeIntent', value.id],
          JSON.parse(JSON.stringify({ record, baseRevision: parents[0] ?? null })),
        );
        this.ledger.flock.commit();
        await this.repo.persistFlockDocNow(this.ledgerId, this.ledger.flock);
        try {
          document.save(value, parents);
        } catch (error) {
          await this.clearIntent(value.id);
          throw error;
        }
        await this.repo.persistDocNow(docId, lease.doc);
      } finally {
        await lease.release();
      }
      // Publication cannot start before body + working catalog are both durable.
      await this.put(record);
      await this.clearIntent(value.id);
      return record;
    });
  }

  remove(entry: PromptShortcutIndexEntry): Promise<void> {
    return this.serialized(async () => {
      await this.recover();
      this.assertOwner(entry);
      const current = this.get(entry.id);
      if (current?.deleted) return;
      if (current?.operation && !sameShortcutIndex(current.entry, entry))
        throw new PromptShortcutError('conflict', 'Shortcut changed since deletion started');
      await this.put({
        entry,
        published: current?.operation ? current.published : entry,
        operation: 'delete',
        deleted: true,
      });
    });
  }

  acknowledge(record: ShortcutLocalRecord, cancelled = false): Promise<void> {
    return this.serialized(async () => {
      await this.recover();
      const current = this.get(record.entry.id);
      if (!current || !sameShortcutRecord(this.publication(record.entry.id), record))
        throw new PromptShortcutError('conflict', 'Publication intent changed');
      const next: ShortcutLocalRecord = {
        ...current,
        published: cancelled ? current.published : record.deleted ? null : record.entry,
        operation:
          !cancelled &&
          current.entry.revision === record.entry.revision &&
          current.deleted === record.deleted
            ? null
            : current.operation,
      };
      this.ledger.flock.set(['shortcut', record.entry.id], JSON.parse(JSON.stringify(next)));
      this.ledger.flock.delete(['publication', record.entry.id]);
      this.ledger.flock.commit();
      await this.repo.persistFlockDocNow(this.ledgerId, this.ledger.flock);
    });
  }

  async dispose() {
    await this.tail;
    await this.ledger.release();
  }
}
