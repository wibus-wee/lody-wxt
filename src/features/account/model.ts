import * as v from 'valibot';

const nonempty = v.pipe(v.string(), v.trim(), v.minLength(1));
const accountConfigSchema = v.strictObject({
  authOrigin: v.pipe(
    v.string(),
    v.url(),
    v.regex(/^https:\/\/[^/?#@]+\/?$/, 'Enter an HTTPS origin without a path or credentials.'),
  ),
  clientId: nonempty,
});
export type AccountConfig = v.InferOutput<typeof accountConfigSchema>;

export const storedSessionSchema = v.strictObject({
  config: accountConfigSchema,
  token: v.object({
    access_token: v.pipe(nonempty, v.regex(/^\S+$/)),
    token_type: v.exactOptional(v.string()),
    expires_in: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(1))),
    scope: v.exactOptional(v.string()),
  }),
  expiresAtMs: v.pipe(v.number(), v.finite(), v.minValue(1)),
  workspaceId: v.nullable(nonempty),
});
export type StoredSession = v.InferOutput<typeof storedSessionSchema>;
export const storedConfigSchema = v.nullable(accountConfigSchema);
export const nullableSessionSchema = v.nullable(storedSessionSchema);

export type AccountErrorContext =
  | { phase: 'requesting'; operation: 'device_code' }
  | { phase: 'authorizing'; operation: 'device_token' }
  | { phase: 'validating'; operation: 'account' | 'workspaces' | 'session' }
  | { phase: 'storage'; operation: 'storage' };

const errorSchema = v.object({
  code: v.picklist([
    'invalid_configuration',
    'invalid_argument',
    'cancelled',
    'timeout',
    'network_error',
    'http_error',
    'invalid_response',
    'unauthenticated',
    'forbidden',
    'access_denied',
    'expired_token',
    'invalid_client',
    'invalid_grant',
    'invalid_request',
    'device_authorization_failed',
    'storage_error',
  ]),
});
export function accountError(error: unknown): string {
  const parsed = v.safeParse(errorSchema, error);
  return parsed.success ? parsed.output.code : 'account_operation_failed';
}

export function sameConfig(left: AccountConfig, right: AccountConfig): boolean {
  return left.authOrigin === right.authOrigin && left.clientId === right.clientId;
}
