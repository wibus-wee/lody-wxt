import { LodySdkError } from '../../shared/domain/errors.js';
import { httpsUrl, nonempty } from '../../shared/domain/values.js';
import type { DeviceAuthorization, DeviceCode, DeviceTokenResult } from './models.js';

export function assertDeviceCode(code: DeviceCode): void {
  if (
    !code ||
    !nonempty(code.device_code) ||
    !nonempty(code.user_code) ||
    !httpsUrl(code.verification_uri) ||
    !httpsUrl(code.verification_uri_complete) ||
    !Number.isSafeInteger(code.expires_in) ||
    code.expires_in <= 0 ||
    !Number.isSafeInteger(code.interval) ||
    code.interval <= 0
  ) {
    throw new LodySdkError('invalid_response');
  }
}

export function authorizeDevice(code: DeviceCode, startedAtMs: number): DeviceAuthorization {
  assertDeviceCode(code);
  const expiresAtMs = startedAtMs + code.expires_in * 1000;
  if (!Number.isFinite(expiresAtMs)) throw new LodySdkError('invalid_response');
  return { code, expiresAtMs };
}

/** Owns the original deadline and cumulative RFC 8628 polling interval. */
export class DeviceFlow {
  private intervalMs: number;
  readonly authorization: DeviceAuthorization;

  constructor(authorization: DeviceAuthorization) {
    assertDeviceCode(authorization.code);
    if (!Number.isFinite(authorization.expiresAtMs)) throw new LodySdkError('invalid_argument');
    this.authorization = Object.freeze({
      code: Object.freeze({ ...authorization.code }),
      expiresAtMs: authorization.expiresAtMs,
    });
    this.intervalMs = authorization.code.interval * 1000;
  }

  assertActive(nowMs: number): void {
    if (nowMs >= this.authorization.expiresAtMs) throw new LodySdkError('expired_token');
  }

  nextPollAt(nowMs: number): number {
    this.assertActive(nowMs);
    return Math.min(nowMs + this.intervalMs, this.authorization.expiresAtMs);
  }

  accept(result: DeviceTokenResult): void {
    if (result.state === 'slow_down') this.intervalMs += 5000;
  }
}
