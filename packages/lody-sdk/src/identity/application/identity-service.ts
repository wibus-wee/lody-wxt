import type { Clock } from '../../shared/application/clock.js';
import type { RequestOptions } from '../../shared/application/request-options.js';
import { LodySdkError } from '../../shared/domain/errors.js';
import { bearerCredential, MAX_TIMER_MS, milliseconds } from '../../shared/domain/values.js';
import { authorizeDevice, DeviceFlow } from '../domain/device-flow.js';
import type {
  Account,
  DeviceAuthorization,
  DeviceToken,
  DeviceTokenResult,
} from '../domain/models.js';
import type { IdentityGateway } from './ports.js';

export class IdentityService {
  constructor(
    private readonly gateway: IdentityGateway,
    private readonly clock: Clock,
    private readonly requestTimeoutMs = 15_000,
  ) {}

  requestDeviceCode = async (options: RequestOptions = {}): Promise<DeviceAuthorization> => {
    const startedAtMs = this.clock.now();
    return authorizeDevice(await this.gateway.requestDeviceCode(options), startedAtMs);
  };

  /** One exchange; callers supplying their own poller own interval and slowdown handling. */
  requestDeviceToken = async (
    authorization: DeviceAuthorization,
    options: RequestOptions = {},
  ): Promise<DeviceTokenResult> => {
    const flow = new DeviceFlow(authorization);
    if (options.signal?.aborted) throw new LodySdkError('cancelled');
    flow.assertActive(this.clock.now());
    return this.gateway.requestDeviceToken(flow.authorization, options);
  };

  waitForDeviceToken = async (
    authorization: DeviceAuthorization,
    options: RequestOptions = {},
  ): Promise<DeviceToken> => {
    const flow = new DeviceFlow(authorization);
    milliseconds(options.timeoutMs ?? this.requestTimeoutMs, 'invalid_argument');
    const signal = options.signal ?? new AbortController().signal;
    while (this.clock.now() < flow.authorization.expiresAtMs) {
      if (signal.aborted) throw new LodySdkError('cancelled');
      const nextPollAt = flow.nextPollAt(this.clock.now());
      try {
        // Native timers cannot represent intervals beyond a signed 32-bit millisecond value.
        do {
          await this.clock.sleep(Math.min(nextPollAt - this.clock.now(), MAX_TIMER_MS), signal);
        } while (this.clock.now() < nextPollAt);
      } catch {
        throw new LodySdkError(signal.aborted ? 'cancelled' : 'network_error');
      }
      if (signal.aborted) throw new LodySdkError('cancelled');
      flow.assertActive(this.clock.now());
      const result = await this.requestDeviceToken(flow.authorization, options);
      if (result.state === 'authorized') return result.token;
      flow.accept(result);
    }
    throw new LodySdkError(signal.aborted ? 'cancelled' : 'expired_token');
  };

  getAccount = async (token: string, options: RequestOptions = {}): Promise<Account> =>
    this.gateway.getAccount(bearerCredential(token), options);
}
