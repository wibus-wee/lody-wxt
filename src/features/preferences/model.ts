export const moods = ['outline', 'duotone', 'fill', 'pixel', 'glass'] as const;
type Mood = (typeof moods)[number];
export interface Preferences {
  mood: Mood;
  displayName: string;
  ambient: boolean;
  theme: 'system' | 'light' | 'dark';
  mode: 'demo' | 'real';
  workspaceId: string;
  autoProject: boolean;
}
export const defaults: Preferences = {
  mood: 'outline',
  displayName: 'Your workspace',
  ambient: false,
  theme: 'system',
  mode: 'demo',
  workspaceId: '',
  autoProject: false,
};

const moodSet = new Set<string>(moods);
function isMood(value: unknown): value is Mood {
  return typeof value === 'string' && moodSet.has(value);
}

export function parsePreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object') return { ...defaults };
  const data = value as Record<string, unknown>;
  return {
    mood: isMood(data.mood) ? data.mood : defaults.mood,
    displayName:
      typeof data.displayName === 'string' &&
      data.displayName.trim().length > 0 &&
      data.displayName.length <= 40
        ? data.displayName
        : defaults.displayName,
    ambient: typeof data.ambient === 'boolean' ? data.ambient : defaults.ambient,
    theme: data.theme === 'light' || data.theme === 'dark' ? data.theme : 'system',
    mode: data.mode === 'real' ? 'real' : 'demo',
    workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId.slice(0, 200) : '',
    autoProject: data.autoProject === true,
  };
}
