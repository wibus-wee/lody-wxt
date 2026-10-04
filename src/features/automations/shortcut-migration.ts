import type { PromptShortcut, ShortcutRuntimeSnapshot } from '@lody-mobile/sdk';
import { parsePromptShortcut } from '@lody-mobile/sdk';
import * as v from 'valibot';
import { browser } from 'wxt/browser';

import { isExtension, writeLocal } from '../../shared/storage';
import type { ChatShortcuts } from '../connection/client';
import type { Workflow } from './storage';
import { loadWorkflows } from './storage';

const recordSchema = v.strictObject({
  legacyId: v.string(),
  bodyDocId: v.string(),
  value: v.unknown(),
  phase: v.exactOptional(v.picklist(['staged', 'accepted', 'completed'])),
});
const recordsSchema = v.array(recordSchema);
interface MigrationRecord {
  legacyId: string;
  bodyDocId: string;
  value: PromptShortcut;
  phase: 'staged' | 'accepted' | 'completed';
}
const keyFor = (scope: string) => `automation:shortcut-migration:${scope}`;
async function readMigration(scope: string): Promise<MigrationRecord[]> {
  const key = keyFor(scope);
  const raw = isExtension()
    ? (await browser.storage.local.get(key))[key]
    : JSON.parse(localStorage.getItem(`lody:${key}`) ?? 'null');
  return raw == null
    ? []
    : v.parse(recordsSchema, raw).map((row) => ({
        ...row,
        value: parsePromptShortcut(row.value),
        phase: row.phase ?? 'staged',
      }));
}

/** Completion is monotonic: later target edits or deletion do not make the legacy row importable again. */
async function checkpoint(
  scope: string,
  records: MigrationRecord[],
  snapshot: ShortcutRuntimeSnapshot,
) {
  let changed = false;
  for (const record of records) {
    if (record.phase === 'completed') continue;
    const entry = snapshot.entries.find((row) => row.id === record.value.id);
    const pending = snapshot.pendingIds.includes(record.value.id);
    let next: MigrationRecord['phase'] = record.phase;
    if (entry) {
      next = entry.revision !== record.value.revision || !pending ? 'completed' : 'accepted';
    } else if (
      record.phase === 'accepted' &&
      !snapshot.loading &&
      !pending &&
      Object.keys(snapshot.errors).length === 0
    ) {
      // An accepted local copy may subsequently be deleted. Never recreate it from the preserved legacy row.
      next = 'completed';
    }
    if (next !== record.phase) {
      record.phase = next;
      changed = true;
    }
  }
  if (changed) await writeLocal(keyFor(scope), records);
}

export async function migrationStatus(scope: string, shortcuts: ChatShortcuts) {
  return navigator.locks.request(keyFor(scope), async () => {
    const [workflows, records] = await Promise.all([loadWorkflows(scope), readMigration(scope)]);
    await checkpoint(scope, records, shortcuts.getSnapshot());
    return workflows.map((workflow) => {
      const record = records.find((row) => row.legacyId === workflow.id);
      return {
        workflow,
        shortcutId: record?.value.id,
        completed: record?.phase === 'completed',
        state:
          record?.phase === 'completed'
            ? ('synced' as const)
            : record
              ? ('pending' as const)
              : ('local' as const),
      };
    });
  });
}

/** Keep originals; stage identity before saving, then retain local acceptance and completion across reconnects. */
export async function migrateWorkflows(input: {
  scope: string;
  shortcuts: ChatShortcuts;
  workspaceId: string;
  userId: string;
  workflows: readonly Workflow[];
}) {
  await navigator.locks.request(keyFor(input.scope), async () => {
    await input.shortcuts.connect();
    const records = await readMigration(input.scope);
    for (const record of records) {
      if (
        record.value.workspaceId !== input.workspaceId ||
        record.value.ownerUserId !== input.userId
      )
        throw new Error('迁移记录属于其他账户或工作区，已停止迁移。');
    }
    await checkpoint(input.scope, records, input.shortcuts.getSnapshot());
    for (const workflow of input.workflows) {
      let record = records.find((row) => row.legacyId === workflow.id);
      if (!record) {
        const id = crypto.randomUUID();
        const now = Date.now();
        record = {
          legacyId: workflow.id,
          bodyDocId: crypto.randomUUID(),
          phase: 'staged',
          value: parsePromptShortcut({
            v: 1,
            id,
            workspaceId: input.workspaceId,
            ownerUserId: input.userId,
            visibility: 'private',
            name: workflow.title.slice(0, 60),
            slug: `import-${id.slice(0, 30)}`,
            description: workflow.title,
            prompt: workflow.prompt,
            mentions: [],
            scope: {},
            revision: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
          }),
        };
        records.push(record);
        await writeLocal(keyFor(input.scope), records);
      }
      if (record.phase !== 'staged') continue;
      const existing = input.shortcuts
        .getSnapshot()
        .entries.find((row) => row.id === record.value.id);
      if (!existing) {
        await input.shortcuts.save({
          value: record.value,
          base: null,
          bodyDocId: record.bodyDocId,
        });
      }
      record.phase = 'accepted';
      await writeLocal(keyFor(input.scope), records);
    }
    try {
      await input.shortcuts.retry();
    } finally {
      await checkpoint(input.scope, records, input.shortcuts.getSnapshot());
    }
  });
}
