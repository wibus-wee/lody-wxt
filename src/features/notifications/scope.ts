import * as v from 'valibot';
import { browser } from 'wxt/browser';

import { nullableSessionSchema } from '../account/model';

export async function notificationAccount() {
  const session = v.parse(
    nullableSessionSchema,
    (await browser.storage.local.get('accountSession')).accountSession ?? null,
  );
  if (!session) return { scope: '', session: null };
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(session)),
  );
  const scope = Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return { scope, session };
}
