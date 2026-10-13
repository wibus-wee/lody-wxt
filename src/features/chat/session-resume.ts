import * as v from 'valibot';

/** Only selection metadata is retained; expiry never deletes remote conversations. */
const SESSION_RESUME_TTL = 5 * 60 * 1000;
const resumeSchema = v.object({ id: v.string(), seenAt: v.pipe(v.number(), v.finite()) });

export function resumeKey(accountKey: string): string {
  // accountKey includes authenticated user, auth origin, workspace and backend.
  return `lody:chat-resume:${accountKey}`;
}

function readRecord(key: string) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const result = v.safeParse(resumeSchema, JSON.parse(raw));
    return result.success ? result.output : null;
  } catch {
    return null;
  }
}

export function readResume(key: string, now = Date.now()): string {
  const record = readRecord(key);
  if (!record) return '';
  const age = now - record.seenAt;
  return age >= 0 && age < SESSION_RESUME_TTL ? record.id : '';
}

export function writeResume(key: string, id: string): void {
  if (id) localStorage.setItem(key, JSON.stringify({ id, seenAt: Date.now() }));
  else localStorage.removeItem(key);
}

export function touchResume(key: string, id: string): void {
  if (readRecord(key)?.id === id) writeResume(key, id);
}
