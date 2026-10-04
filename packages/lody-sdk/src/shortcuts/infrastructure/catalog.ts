import type { Flock } from '@loro-dev/flock-wasm';
import * as v from 'valibot';

import type {
  PromptShortcut,
  PromptShortcutCatalogRecord,
  PromptShortcutIndexEntry,
} from '../domain/models.js';
import {
  PROMPT_SHORTCUT_LIMITS,
  PromptShortcutError,
  shortcutByteLength,
} from '../domain/models.js';
import { catalogRecordSchema as recordSchema, PromptShortcutIndexSchema } from './schemas.js';

export function projectShortcutIndex(
  shortcut: PromptShortcut,
  bodyDocId: string,
): PromptShortcutIndexEntry {
  const { prompt: _prompt, mentions, ...summary } = shortcut;
  const targets = new Map(
    mentions.map((mention) => [JSON.stringify(mention.target), mention.target]),
  );
  return parseShortcutIndex({
    ...summary,
    bodyDocId,
    dependencySummary: [...targets.values()],
  });
}

export function parseShortcutIndex(value: unknown): PromptShortcutIndexEntry {
  const result = v.safeParse(PromptShortcutIndexSchema, value);
  if (!result.success) throw new PromptShortcutError('invalid_template', 'Invalid shortcut index');
  if (shortcutByteLength(JSON.stringify(result.output)) > PROMPT_SHORTCUT_LIMITS.indexBytes) {
    throw new PromptShortcutError('size_limit', 'Shortcut index exceeds the byte limit');
  }
  return result.output;
}

export interface PromptShortcutFlock {
  get: (key: (string | number)[]) => unknown;
  scan: (options: {
    prefix: (string | number)[];
  }) => Iterable<{ key: readonly unknown[]; value?: unknown }>;
  set: Flock['set'];
  delete: (key: (string | number)[]) => void;
  commit: () => void;
}

export class PromptShortcutCatalog {
  constructor(readonly flock: PromptShortcutFlock) {}

  get(id: string): PromptShortcutCatalogRecord | null {
    const tombstone = this.flock.get(['deletedPromptShortcut', id]);
    if (tombstone != null) {
      if (!v.is(v.string(), tombstone) || !tombstone)
        throw new PromptShortcutError('invalid_template', 'Invalid shortcut tombstone');
      return { kind: 'deleted', id, revision: tombstone };
    }
    const value = this.flock.get(['promptShortcut', id]);
    if (value == null) return null;
    const parsed = v.safeParse(recordSchema, value);
    if (!parsed.success)
      throw new PromptShortcutError('invalid_template', 'Invalid shortcut catalog row');
    const record = parsed.output;
    if ((record.kind === 'active' ? record.entry.id : record.id) !== id) {
      throw new PromptShortcutError('invalid_template', 'Catalog key does not match its value');
    }
    if (record.kind === 'active')
      return { kind: 'active', entry: parseShortcutIndex(record.entry) };
    return record;
  }

  list(): PromptShortcutIndexEntry[] {
    const entries: PromptShortcutIndexEntry[] = [];
    for (const row of this.flock.scan({ prefix: ['promptShortcut'] })) {
      if (row.key.length !== 2 || !v.is(v.string(), row.key[1])) continue;
      const record = this.get(row.key[1]);
      if (record?.kind === 'active') entries.push(record.entry);
    }
    return entries;
  }

  put(entry: PromptShortcutIndexEntry): void {
    const parsed = parseShortcutIndex(entry);
    if (this.get(parsed.id)?.kind === 'deleted')
      throw new PromptShortcutError('conflict', 'Deleted shortcuts cannot be resurrected');
    const existingEntries = this.list();
    for (const existing of existingEntries) {
      if (existing.id !== parsed.id && existing.slug === parsed.slug) {
        throw new PromptShortcutError('conflict', 'Shortcut slug is already in use');
      }
    }
    const next = [...existingEntries.filter((existing) => existing.id !== parsed.id), parsed];
    if (next.length > 100 || shortcutByteLength(JSON.stringify(next)) > 512 * 1024) {
      throw new PromptShortcutError('size_limit', 'Shortcut catalog exceeds its quota');
    }
    this.flock.set(
      ['promptShortcut', parsed.id],
      JSON.parse(JSON.stringify({ kind: 'active', entry: parsed })),
    );
    this.flock.commit();
  }

  remove(id: string, revision: string): void {
    // A separate monotonic tombstone wins even when an older active row arrives later.
    this.flock.set(['deletedPromptShortcut', id], revision);
    this.flock.commit();
  }

  /** A visibility withdrawal is reversible, unlike business-identity deletion. */
  withdraw(id: string, bodyDocId: string): void {
    const current = this.get(id);
    if (current?.kind !== 'active' || current.entry.bodyDocId !== bodyDocId) return;
    this.flock.delete(['promptShortcut', id]);
    this.flock.commit();
  }
}
