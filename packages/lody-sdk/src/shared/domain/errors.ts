export type SdkErrorCode =
  | 'invalid_configuration'
  | 'invalid_argument'
  | 'cancelled'
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'invalid_response'
  | 'unauthenticated'
  | 'forbidden'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_request'
  | 'device_authorization_failed';

/** Only code and HTTP status are retained; transport causes and response bodies are discarded. */
export class LodySdkError extends Error {
  readonly code: SdkErrorCode;
  readonly status: number | undefined;

  constructor(code: SdkErrorCode, status?: number) {
    super(`Lody SDK: ${code}`);
    this.name = 'LodySdkError';
    this.code = code;
    this.status = status;
  }
}
