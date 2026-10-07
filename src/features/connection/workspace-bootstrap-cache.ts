import * as v from 'valibot';
import { browser } from 'wxt/browser';

import type { StoredSession } from '../account/model';

/**
 * Derived, non-secret facts about a workspace bootstrap that already succeeded for one
 * exact credential.
 *
 * An MV3 service worker is evicted after a short idle window and the sync alarm restarts
 * it roughly once a minute, so every wake repeats the identity, membership and machine
 * directory round trips even though the answer cannot have changed. Caching them turns a
 * worker respawn back into the single request it cannot avoid.
 *
 * The bearer grant is deliberately absent: `streams.getGrant` stays on the live path
 * because it is the authoritative check that this credential still reaches this
 * workspace, so this cache never substitutes an authorization result for a live one.
 */
const storageKey = 'lody:workspace:bootstrap';

/**
 * Revalidate a cached bootstrap at least this often, so a workspace the user lost access
 * to, or a machine that was added, is picked up without a sign-out.
 */
const maxAgeMs = 10 * 60_000;

const cachedBootstrapSchema = v.strictObject({
  credential: v.pipe(v.string(), v.minLength(1)),
  accountId: v.pipe(v.string(), v.minLength(1)),
  gatewayBaseUrl: v.pipe(v.string(), v.minLength(1)),
  machineIds: v.array(v.pipe(v.string(), v.minLength(1))),
  verifiedAtMs: v.pipe(v.number(), v.finite()),
});

export type CachedBootstrap = v.InferOutput<typeof cachedBootstrapSchema>;
export type BootstrapFacts = Pick<CachedBootstrap, 'accountId' | 'gatewayBaseUrl' | 'machineIds'>;

/**
 * Identifies the credential a bootstrap was verified against, so edits never match.
 *
 * Hashed rather than stored verbatim: the cache must not become a second copy of the access
 * token, and the key only has to make a mismatch detectable, not be reversible.
 */
async function credentialKey(session: StoredSession): Promise<string> {
  const material = JSON.stringify([
    session.config.authOrigin,
    session.config.clientId,
    session.token.access_token,
    session.expiresAtMs,
    session.workspaceId,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readCachedBootstrap(session: StoredSession): Promise<CachedBootstrap | null> {
  const credential = await credentialKey(session);
  const stored = await browser.storage.session.get(storageKey).catch(() => null);
  const parsed = v.safeParse(cachedBootstrapSchema, stored?.[storageKey]);
  if (!parsed.success || parsed.output.credential !== credential) return null;
  const age = Date.now() - parsed.output.verifiedAtMs;
  return age >= 0 && age < maxAgeMs ? parsed.output : null;
}

export async function writeCachedBootstrap(
  session: StoredSession,
  facts: BootstrapFacts,
): Promise<void> {
  const entry = v.safeParse(cachedBootstrapSchema, {
    ...facts,
    credential: await credentialKey(session),
    verifiedAtMs: Date.now(),
  });
  if (!entry.success) return;
  await browser.storage.session.set({ [storageKey]: entry.output }).catch(() => {});
}

/** Drop the cache when the credential it described is gone or replaced. */
export async function clearCachedBootstrap(): Promise<void> {
  await browser.storage.session.remove(storageKey).catch(() => {});
}
