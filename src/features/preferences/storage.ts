import { readLocal, watchLocal, writeLocal } from '../../shared/storage';
import type { Preferences, PreferencesInput } from './model';
import { parsePreferences } from './model';

export async function loadPreferences(): Promise<Preferences> {
  return parsePreferences(await readLocal('preferences'));
}

export async function savePreferences(value: PreferencesInput): Promise<void> {
  await writeLocal('preferences', parsePreferences(value));
}

export function watchPreferences(onChange: (value: Preferences) => void): () => void {
  return watchLocal('preferences', () => void loadPreferences().then(onChange));
}
