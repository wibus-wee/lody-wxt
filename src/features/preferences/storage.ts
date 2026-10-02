import { browser } from 'wxt/browser';

import type { Preferences } from './model';
import { defaults, parsePreferences } from './model';

function isExtension() {
  return location.protocol === 'chrome-extension:' || location.protocol === 'moz-extension:';
}

export async function loadPreferences(): Promise<Preferences> {
  if (isExtension()) {
    const result = await browser.storage.local.get('preferences');
    return parsePreferences(result.preferences);
  }
  try {
    return parsePreferences(JSON.parse(localStorage.getItem('lody:preferences') ?? 'null'));
  } catch {
    return { ...defaults };
  }
}

export async function savePreferences(value: Preferences): Promise<void> {
  if (isExtension()) await browser.storage.local.set({ preferences: value });
  else localStorage.setItem('lody:preferences', JSON.stringify(value));
}

export function watchPreferences(onChange: (value: Preferences) => void): () => void {
  if (isExtension()) {
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && 'preferences' in changes)
        onChange(parsePreferences(changes.preferences?.newValue));
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }
  const listener = (event: StorageEvent) => {
    if (event.key === 'lody:preferences') void loadPreferences().then(onChange);
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
