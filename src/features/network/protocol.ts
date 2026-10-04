import * as v from 'valibot';

export const networkLimits = Object.freeze({
  timeoutMs: 15_000,
  maxResponseBytes: 1_048_576,
  maxRequestBytes: 1_048_576,
});

const requestId = v.pipe(v.string(), v.regex(/^[\da-f-]{36}$/i));
const rejectionSchema = v.strictObject({
  stage: v.picklist([
    'message',
    'route',
    'headers',
    'get_body',
    'request_size',
    'duplicate_request',
  ]),
  operation: v.picklist([
    'unknown',
    'device_code',
    'device_token',
    'account',
    'workspaces',
    'cloud_auth',
    'streams_grant',
    'cloud_query',
    'cloud_action',
    'cloud_mutation',
    'shortcut_directory',
    'shortcut_grant',
    'shortcut_stage',
    'shortcut_activate',
    'shortcut_settle',
    'shortcut_revoke',
  ]),
});
export type NetworkRejection = v.InferOutput<typeof rejectionSchema>;
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
    rejection: v.exactOptional(rejectionSchema),
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

const operations: Readonly<Record<string, NetworkRejection['operation']>> = {
  '/api/auth/device/code': 'device_code',
  '/api/auth/device/token': 'device_token',
  '/api/auth/get-session': 'account',
  '/api/auth/organization/list': 'workspaces',
  '/api/auth/convex/token': 'cloud_auth',
  '/api/loro-streams/token': 'streams_grant',
  '/api/query': 'cloud_query',
  '/api/action': 'cloud_action',
  '/api/mutation': 'cloud_mutation',
};
const shortcutOperations: Readonly<Record<string, NetworkRejection['operation']>> = {
  'promptShortcuts:listAccessibleDocuments': 'shortcut_directory',
  'promptShortcuts:getStreamToken': 'shortcut_grant',
  'promptShortcuts:stageDocument': 'shortcut_stage',
  'promptShortcuts:activateDocument': 'shortcut_activate',
  'promptShortcuts:settleDocument': 'shortcut_settle',
  'promptShortcuts:revokeShortcut': 'shortcut_revoke',
};

/** Diagnostics contain registered operation names, never request URLs, headers or content. */
export function networkOperation(url: string, body?: string): NetworkRejection['operation'] {
  try {
    const parsed = new URL(url);
    if (!new Set(['https://backend.lody.ai', 'https://convex.lody.ai']).has(parsed.origin))
      return 'unknown';
    const operation = operations[parsed.pathname] ?? 'unknown';
    if (parsed.origin === 'https://convex.lody.ai' && body) {
      const envelope = v.safeParse(v.object({ path: v.string() }), JSON.parse(body));
      if (envelope.success && Object.hasOwn(shortcutOperations, envelope.output.path))
        return shortcutOperations[envelope.output.path]!;
    }
    return operation;
  } catch {
    return 'unknown';
  }
}

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
          new Set(['/api/query', '/api/action', '/api/mutation']).has(parsed.pathname) &&
          method === 'POST'))
    );
  } catch {
    return false;
  }
}
