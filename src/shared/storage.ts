import { browser } from 'wxt/browser';

export function isExtension() {
  return (
    typeof location !== 'undefined' &&
    ['chrome-extension:', 'moz-extension:'].includes(location.protocol)
  );
}

export async function readLocal<T>(key: string, fallback: T): Promise<T> {
  if (isExtension()) return ((await browser.storage.local.get(key))[key] as T) ?? fallback;
  const raw = localStorage.getItem(`lody:${key}`);
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function writeLocal(key: string, value: unknown) {
  if (isExtension()) await browser.storage.local.set({ [key]: value });
  else localStorage.setItem(`lody:${key}`, JSON.stringify(value));
}

export function watchLocal(key: string, notify: () => void) {
  if (isExtension()) {
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && key in changes) notify();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }
  const listener = (event: StorageEvent) => {
    if (event.key === `lody:${key}`) notify();
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
