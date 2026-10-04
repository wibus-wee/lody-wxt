import * as v from 'valibot';

export const moods = ['outline', 'duotone', 'fill', 'pixel', 'glass'] as const;
type Mood = (typeof moods)[number];
export interface Preferences {
  mood: Mood;
  displayName: string;
  ambient: boolean;
  theme: 'system' | 'light' | 'dark';
  mode: 'real';
  workspaceId: string;
  autoProject: boolean;
}
export const defaults: Preferences = {
  mood: 'outline',
  displayName: 'Your workspace',
  ambient: false,
  theme: 'system',
  mode: 'real',
  workspaceId: '',
  autoProject: false,
};

export type PreferencesInput = Pick<Preferences, 'mood' | 'displayName' | 'ambient'> &
  Partial<Preferences>;

const preferencesSchema = v.object({
  mood: v.fallback(v.picklist(moods), defaults.mood),
  displayName: v.fallback(
    v.pipe(
      v.string(),
      v.maxLength(40),
      v.check((name) => name.trim().length > 0),
    ),
    defaults.displayName,
  ),
  ambient: v.fallback(v.boolean(), defaults.ambient),
  theme: v.fallback(v.picklist(['system', 'light', 'dark']), defaults.theme),
  mode: v.fallback(v.literal('real'), defaults.mode),
  workspaceId: v.fallback(v.pipe(v.string(), v.maxLength(200)), defaults.workspaceId),
  autoProject: v.fallback(v.boolean(), defaults.autoProject),
});

export function parsePreferences(value: unknown): Preferences {
  const result = v.safeParse(preferencesSchema, value);
  return result.success ? result.output : { ...defaults };
}
