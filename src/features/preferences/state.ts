import { atom } from 'jotai';

import type { Preferences } from './model';
import { defaults } from './model';

export const preferencesAtom = atom<Preferences>({ ...defaults });
export const moodAtom = atom((get) => get(preferencesAtom).mood);
