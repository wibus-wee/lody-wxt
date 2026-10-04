import * as v from 'valibot';

export const networkLimits = Object.freeze({
  timeoutMs: 15_000,
  maxResponseBytes: 1_048_576,
  maxRequestBytes: 1_048_576,
});

const requestId = v.pipe(v.string(), v.regex(/^[\da-f-]{36}$/i));
export const networkMessageSchema = v.variant('type', [
  v.strictObject({ type: v.literal('network:cancel'), requestId }),
  v.strictObject({
    type: v.literal('network:request'),
    requestId,
    url: v.string(),
    method: v.picklist(['GET', 'POST']),
    headers: v.record(v.string(), v.string()),
    body: v.optional(v.string()),
    credentials: v.literal('omit'),
    redirect: v.literal('error'),
    deadline: v.pipe(v.number(), v.finite()),
  }),
]);

export const networkReplySchema = v.variant('ok', [
  v.strictObject({
    ok: v.literal(true),
    status: v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(599)),
    data: v.unknown(),
  }),
  v.strictObject({
    ok: v.literal(false),
    code: v.picklist([
      'invalid_request',
      'forbidden',
      'cancelled',
      'timeout',
      'response_too_large',
      'invalid_json',
      'network_error',
    ]),
  }),
]);
export type NetworkReply = v.InferOutput<typeof networkReplySchema>;

const routes: Readonly<Record<string, string>> = {
  '/api/auth/device/code': 'POST',
  '/api/auth/device/token': 'POST',
  '/api/auth/get-session': 'GET',
  '/api/auth/organization/list': 'GET',
  '/api/auth/convex/token': 'GET',
  '/api/loro-streams/token': 'POST',
};

export function allowedRequest(url: string, method: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      ((parsed.origin === 'https://backend.lody.ai' && routes[parsed.pathname] === method) ||
        (parsed.origin === 'https://convex.lody.ai' &&
          parsed.pathname === '/api/query' &&
          method === 'POST'))
    );
  } catch {
    return false;
  }
}
