import type { RequestOptions } from '../../shared/application/request-options.js';
import type {
  Account,
  DeviceAuthorization,
  DeviceCode,
  DeviceTokenResult,
} from '../domain/models.js';

export interface IdentityGateway {
  requestDeviceCode: (options: RequestOptions) => Promise<DeviceCode>;
  requestDeviceToken: (
    authorization: DeviceAuthorization,
    options: RequestOptions,
  ) => Promise<DeviceTokenResult>;
  getAccount: (credential: string, options: RequestOptions) => Promise<Account>;
}
