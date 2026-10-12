/** Only selection metadata is retained; expiry never deletes remote conversations. */
export const SESSION_RESUME_TTL = 5 * 60 * 1000;

export function resumeKey(accountKey: string): string {
  // accountKey already includes authenticated user, auth origin, workspace and backend.
  return `lody:chat-resume:${accountKey}`;
}

export function readResume(key: string, now = Date.now()): string {
  const raw = localStorage.getItem(key);
  if (!raw) return '';
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return '';
  }
  if (!record || typeof record !== 'object') return '';
  if (!('id' in record) || typeof record.id !== 'string') return '';
  if (!('seenAt' in record) || typeof record.seenAt !== 'number') return '';
  const age = now - record.seenAt;
  return Number.isFinite(age) && age >= 0 && age < SESSION_RESUME_TTL ? record.id : '';
}

export function writeResume(key: string, id: string): void {
  if (id) localStorage.setItem(key, JSON.stringify({ id, seenAt: Date.now() }));
  else localStorage.removeItem(key);
}

export function touchResume(key: string, id: string): void {
  const raw = localStorage.getItem(key);
  if (!raw) return;
  const record: unknown = JSON.parse(raw);
  if (record && typeof record === 'object' && 'id' in record && record.id === id)
    writeResume(key, id);
}
