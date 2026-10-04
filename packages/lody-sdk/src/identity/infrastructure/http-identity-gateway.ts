import * as v from 'valibot';

import type { RequestOptions } from '../../shared/application/request-options.js';
import type { SdkErrorCode } from '../../shared/domain/errors.js';
import { LodySdkError } from '../../shared/domain/errors.js';
import { nonempty } from '../../shared/domain/values.js';
import type { HttpClient } from '../../shared/infrastructure/http/http-client.js';
import { parseResponse, recordSchema } from '../../shared/infrastructure/http/schemas.js';
import type { IdentityGateway } from '../application/ports.js';
import type {
  Account,
  DeviceAuthorization,
  DeviceCode,
  DeviceTokenResult,
} from '../domain/models.js';
import { accountSchema, deviceCodeSchema, deviceTokenSchema } from './schemas.js';

const deviceErrors: Readonly<Record<string, SdkErrorCode>> = {
  access_denied: 'access_denied',
  expired_token: 'expired_token',
  invalid_client: 'invalid_client',
  invalid_grant: 'invalid_grant',
  invalid_request: 'invalid_request',
};

function deviceError(row: Record<string, unknown>, status: number): never {
  if (!nonempty(row.error)) throw new LodySdkError('invalid_response', status);
  const code = Object.hasOwn(deviceErrors, row.error) ? deviceErrors[row.error] : undefined;
  throw new LodySdkError(code ?? 'device_authorization_failed', status);
}

/** Maps Better Auth HTTP payloads into the identity application's port. */
export class HttpIdentityGateway implements IdentityGateway {
  constructor(
    private readonly http: HttpClient,
    private readonly clientId: string,
  ) {}

  async requestDeviceCode(options: RequestOptions): Promise<DeviceCode> {
    const { data, status } = await this.http.request(
      '/api/auth/device/code',
      { client_id: this.clientId },
      undefined,
      options,
      true,
    );
    const row = parseResponse(recordSchema, data);
    if (Object.hasOwn(row, 'error') || status === 400) deviceError(row, status);
    return parseResponse(deviceCodeSchema, row);
  }

  async requestDeviceToken(
    authorization: DeviceAuthorization,
    options: RequestOptions,
  ): Promise<DeviceTokenResult> {
    const { data, status } = await this.http.request(
      '/api/auth/device/token',
      {
        client_id: this.clientId,
        device_code: authorization.code.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
      undefined,
      options,
      true,
      authorization.expiresAtMs,
    );
    const row = parseResponse(recordSchema, data);
    if (Object.hasOwn(row, 'error')) {
      if (Object.hasOwn(row, 'access_token')) throw new LodySdkError('invalid_response', status);
      const pending = v.safeParse(v.picklist(['authorization_pending', 'slow_down']), row.error);
      if (pending.success) return { state: pending.output };
      deviceError(row, status);
    }
    if (status === 400) throw new LodySdkError('invalid_response', status);
    return { state: 'authorized', token: parseResponse(deviceTokenSchema, row) };
  }

  async getAccount(credential: string, options: RequestOptions): Promise<Account> {
    const { data } = await this.http.request(
      '/api/auth/get-session',
      undefined,
      credential,
      options,
    );
    if (data === null) throw new LodySdkError('unauthenticated');
    return parseResponse(accountSchema, data);
  }
}
