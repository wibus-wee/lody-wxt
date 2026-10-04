import { LodySdkError } from './errors.js';

// The dependency-free domain validates primitive caller inputs before string operations.
// ast-grep-ignore: no-unknown-parameter, no-manual-type-guard
export function nonempty(value: unknown): value is string {
  // Keep schema libraries outside the domain; this check establishes the primitive string contract.
  // ast-grep-ignore: no-typeof-operator
  return typeof value === 'string' && value.trim().length > 0;
}

// Public configuration accepts untrusted values; the domain primitive guard narrows them first.
// ast-grep-ignore: no-unknown-parameter
export function httpsUrl(value: unknown, baseOnly = false): boolean {
  if (!nonempty(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!baseOnly || (!url.search && !url.hash))
    );
  } catch {
    return false;
  }
}

export const MAX_TIMER_MS = 2_147_483_647;

export function milliseconds(
  value: number,
  code: 'invalid_configuration' | 'invalid_argument',
): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_MS) throw new LodySdkError(code);
  return value;
}

const credentialNewlinePattern = /[\r\n]/;

export function bearerCredential(value: string): string {
  if (!nonempty(value) || credentialNewlinePattern.test(value))
    throw new LodySdkError('invalid_argument');
  return value;
}
