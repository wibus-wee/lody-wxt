import * as v from 'valibot';
import { browser } from 'wxt/browser';

import type { SendJournal } from './model';
import { journalSchema } from './model';

export interface JournalStorage {
  load: (key: string) => Promise<SendJournal | null>;
  claim: (journal: SendJournal) => Promise<boolean>;
  save: (journal: SendJournal) => Promise<void>;
  clear: (key: string) => Promise<void>;
}

export function createJournalStorage(): JournalStorage {
  const extension = new Set(['chrome-extension:', 'moz-extension:']).has(location.protocol);
  const load = async (key: string) => {
    const value = extension
      ? (await browser.storage.local.get(key))[key]
      : JSON.parse(localStorage.getItem(key) ?? 'null');
    return v.parse(v.nullable(journalSchema), value ?? null);
  };
  const save = async (journal: SendJournal) => {
    const value = v.parse(journalSchema, journal);
    if (extension) await browser.storage.local.set({ [value.key]: value });
    else localStorage.setItem(value.key, JSON.stringify(value));
  };
  return {
    load,
    save,
    async claim(journal) {
      return navigator.locks.request(journal.key, async () => {
        if (await load(journal.key)) return false;
        await save(journal);
        return true;
      });
    },
    async clear(key) {
      await navigator.locks.request(key, async () => {
        if (extension) await browser.storage.local.remove(key);
        else localStorage.removeItem(key);
      });
    },
  };
}
