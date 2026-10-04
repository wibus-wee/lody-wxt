import * as v from 'valibot';
import { browser } from 'wxt/browser';

import type { ConversationDraft } from './model';
import { savedDraftSchema } from './model';

export function createDraftStorage() {
  const extension = new Set(['chrome-extension:', 'moz-extension:']).has(location.protocol);
  let writes = Promise.resolve();
  return {
    async load(scope: string): Promise<ConversationDraft | null> {
      await writes;
      const key = `lody:conversation:draft:${scope}`;
      const value = extension
        ? (await browser.storage.local.get(key))[key]
        : JSON.parse(localStorage.getItem(key) ?? 'null');
      return v.parse(v.nullable(savedDraftSchema), value ?? null);
    },
    save(scope: string, draft: ConversationDraft): Promise<void> {
      const key = `lody:conversation:draft:${scope}`;
      const value = v.parse(savedDraftSchema, draft);
      if (!extension) {
        localStorage.setItem(key, JSON.stringify(value));
        return Promise.resolve();
      }
      writes = writes.catch(() => {}).then(() => browser.storage.local.set({ [key]: value }));
      return writes;
    },
  };
}
