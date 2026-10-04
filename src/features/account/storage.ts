import * as v from 'valibot';
import { browser } from 'wxt/browser';

import type { AccountConfig, StoredSession } from './model';
import { nullableSessionSchema, storedConfigSchema } from './model';

export interface AccountStorage {
  loadConfig: () => Promise<AccountConfig | null>;
  saveConfig: (config: AccountConfig | null) => Promise<void>;
  loadSession: () => Promise<StoredSession | null>;
  saveSession: (session: StoredSession | null) => Promise<void>;
  watch: (listener: (change: AccountStorageChange) => void) => () => void;
}

export type AccountStorageChange =
  | { key: 'config'; value: AccountConfig | null }
  | { key: 'session'; value: StoredSession | null };

export class AccountStorageError extends Error {
  readonly code = 'storage_error';
  constructor(cause: ErrorOptions['cause']) {
    super('Account storage operation failed', { cause });
    this.name = 'AccountStorageError';
  }
}

async function storageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    throw new AccountStorageError(cause);
  }
}

export function restrictAccountStorageAccess(): Promise<void> {
  return storageOperation(() =>
    browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  );
}

export function registerAccountStorageLifecycle(): Promise<void> {
  const restrict = () => {
    void restrictAccountStorageAccess();
  };
  browser.runtime.onInstalled.addListener(restrict);
  browser.runtime.onStartup.addListener(restrict);
  return restrictAccountStorageAccess();
}

function decode(value: string | null): unknown {
  try {
    return JSON.parse(value ?? 'null');
  } catch {
    return value;
  }
}

export function createAccountStorage(): AccountStorage {
  const extension = new Set(['chrome-extension:', 'moz-extension:']).has(location.protocol);
  let secured: Promise<void> | undefined;
  const secure = () =>
    (secured ??= restrictAccountStorageAccess().catch((error) => {
      secured = undefined;
      throw error;
    }));
  const echoes = new Map<string, string>();
  async function write(key: string, value: AccountConfig | StoredSession | null) {
    if (extension) {
      await secure();
      echoes.set(key, JSON.stringify(value));
      if (value === null) await browser.storage.local.remove(key);
      else await browser.storage.local.set({ [key]: value });
    } else {
      const webKey = key === 'accountConfig' ? 'lody:account:config' : 'lody:account:session';
      if (value === null) localStorage.removeItem(webKey);
      else localStorage.setItem(webKey, JSON.stringify(value));
    }
  }
  async function removeLegacySession() {
    if (extension) await browser.storage.session.remove('accountSession');
    else sessionStorage.removeItem('lody:account:session');
  }
  return {
    loadConfig: () =>
      storageOperation(async () => {
        if (extension) await secure();
        const value = extension
          ? ((await browser.storage.local.get('accountConfig')).accountConfig ?? null)
          : decode(localStorage.getItem('lody:account:config'));
        const result = v.safeParse(storedConfigSchema, value);
        if (!result.success) await write('accountConfig', null);
        return result.success ? result.output : null;
      }),
    saveConfig: (config) =>
      storageOperation(() => write('accountConfig', v.parse(storedConfigSchema, config))),
    loadSession: () =>
      storageOperation(async () => {
        if (extension) await secure();
        const durable = extension
          ? (await browser.storage.local.get('accountSession')).accountSession
          : decode(localStorage.getItem('lody:account:session'));
        if (durable != null) {
          const result = v.safeParse(nullableSessionSchema, durable);
          if (!result.success) await write('accountSession', null);
          await removeLegacySession();
          return result.success ? result.output : null;
        }
        const legacy = extension
          ? ((await browser.storage.session.get('accountSession')).accountSession ?? null)
          : decode(sessionStorage.getItem('lody:account:session'));
        const result = v.safeParse(nullableSessionSchema, legacy);
        const session = result.success ? result.output : null;
        if (session) await write('accountSession', session);
        await removeLegacySession();
        return session;
      }),
    saveSession: (session) =>
      storageOperation(async () => {
        await write('accountSession', v.parse(nullableSessionSchema, session));
        await removeLegacySession();
      }),
    watch(listener) {
      function notify(key: string, value: unknown) {
        const parsed =
          key === 'accountConfig'
            ? v.safeParse(storedConfigSchema, value)
            : v.safeParse(nullableSessionSchema, value);
        if (echoes.get(key) === JSON.stringify(value)) {
          echoes.delete(key);
          return;
        }
        if (key === 'accountConfig')
          listener({
            key: 'config',
            value: parsed.success ? (parsed.output as AccountConfig | null) : null,
          });
        else
          listener({
            key: 'session',
            value: parsed.success ? (parsed.output as StoredSession | null) : null,
          });
      }
      if (extension) {
        const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
          if (area !== 'local') return;
          for (const key of ['accountConfig', 'accountSession']) {
            if (changes[key] !== undefined) notify(key, changes[key].newValue ?? null);
          }
        };
        browser.storage.onChanged.addListener(changed);
        return () => browser.storage.onChanged.removeListener(changed);
      }
      const changed = (event: StorageEvent) => {
        if (event.storageArea !== localStorage) return;
        if (new Set<string | null>([null, 'lody:account:config']).has(event.key))
          notify('accountConfig', event.key === null ? null : decode(event.newValue));
        if (new Set<string | null>([null, 'lody:account:session']).has(event.key))
          notify('accountSession', event.key === null ? null : decode(event.newValue));
      };
      window.addEventListener('storage', changed);
      return () => window.removeEventListener('storage', changed);
    },
  };
}
