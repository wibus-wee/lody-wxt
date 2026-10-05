import { createStore } from 'jotai';
import { afterEach, expect, it } from 'vitest';

import { defaults } from '../../src/features/preferences/model';
import { moodAtom, preferencesAtom } from '../../src/features/preferences/state';
import {
  loadPreferences,
  savePreferences,
  watchPreferences,
} from '../../src/features/preferences/storage';

afterEach(() => localStorage.removeItem('lody:preferences'));

it('legacy icon preferences hydrate as outline without losing other preferences', async () => {
  const value = { mood: 'glass', displayName: 'Focus', ambient: true } as const;
  localStorage.setItem('lody:preferences', JSON.stringify(value));
  const store = createStore();
  store.set(preferencesAtom, await loadPreferences());
  expect(store.get(moodAtom)).toBe('outline');
  expect(store.get(preferencesAtom)).toEqual({ ...defaults, ...value, mood: 'outline' });
});

it('corrupted browser storage recovers defaults', async () => {
  localStorage.setItem('lody:preferences', '{broken');
  expect(await loadPreferences()).toEqual(defaults);
  localStorage.setItem(
    'lody:preferences',
    JSON.stringify({ mood: 'unknown', displayName: ' ', ambient: 'yes' }),
  );
  expect(await loadPreferences()).toEqual(defaults);
});

it('a storage notification hydrates subscribers and cleanup removes the listener', async () => {
  const values: unknown[] = [];
  const stop = watchPreferences((value) => values.push(value));
  await savePreferences({ ...defaults, ambient: true });
  window.dispatchEvent(new StorageEvent('storage', { key: 'lody:preferences' }));
  await expect.poll(() => values.length).toBe(1);
  expect(values[0]).toEqual({ ...defaults, ambient: true });
  stop();
  window.dispatchEvent(new StorageEvent('storage', { key: 'lody:preferences' }));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(values).toHaveLength(1);
});
