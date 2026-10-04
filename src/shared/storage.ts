import { browser } from 'wxt/browser';

export function isExtension() {
  return new Set(['chrome-extension:', 'moz-extension:']).has(globalThis.location?.protocol ?? '');
}

export async function readLocal(key: string): Promise<unknown> {
  if (isExtension()) return (await browser.storage.local.get(key))[key];
  try {
    return JSON.parse(localStorage.getItem(`lody:${key}`) ?? 'null');
  } catch {
    return null;
  }
}

export async function writeLocal(key: string, value: object): Promise<void> {
  if (isExtension()) await browser.storage.local.set({ [key]: value });
  else localStorage.setItem(`lody:${key}`, JSON.stringify(value));
}

export function watchLocal(key: string, notify: () => void): () => void {
  if (isExtension()) {
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && Object.hasOwn(changes, key)) notify();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }
  const keys = new Set<string | null>([`lody:${key}`, null]);
  const listener = (event: StorageEvent) => {
    if (event.storageArea === sessionStorage) return;
    if (keys.has(event.key)) notify();
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
