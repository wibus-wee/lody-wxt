import type {
  PromptShortcutIndexEntry,
  ShortcutDirectoryEntry,
  ShortcutLocalRecord,
  ShortcutResource,
  ShortcutStreamGrant,
} from '../domain/models.js';

export interface ShortcutRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface ShortcutSyncLease {
  sync: () => Promise<void>;
  join: () => Promise<void>;
  release: () => Promise<void>;
}
export interface ShortcutPublicationPort {
  acquire: (resource: ShortcutResource, write: boolean) => Promise<ShortcutSyncLease>;
  stage: (record: ShortcutLocalRecord) => Promise<'staged' | 'active'>;
  activate: (record: ShortcutLocalRecord) => Promise<void>;
  settle: (record: ShortcutLocalRecord) => Promise<'active' | 'cancelled'>;
  revoke: (entry: PromptShortcutIndexEntry) => Promise<void>;
  dispose: () => Promise<void>;
}
export interface ShortcutCloudPort {
  listAccessibleDocuments: (options?: ShortcutRequestOptions) => Promise<ShortcutDirectoryEntry[]>;
  getStreamToken: (
    resource: ShortcutResource,
    write: boolean,
    options?: ShortcutRequestOptions,
  ) => Promise<ShortcutStreamGrant>;
  stage: (
    record: ShortcutLocalRecord,
    options?: ShortcutRequestOptions,
  ) => Promise<'staged' | 'active'>;
  activate: (record: ShortcutLocalRecord, options?: ShortcutRequestOptions) => Promise<void>;
  settle: (
    record: ShortcutLocalRecord,
    options?: ShortcutRequestOptions,
  ) => Promise<'active' | 'cancelled'>;
  revoke: (entry: PromptShortcutIndexEntry, options?: ShortcutRequestOptions) => Promise<void>;
}
