import { LodySdkError } from '../../shared/domain/errors.js';
import { nonempty } from '../../shared/domain/values.js';

export function rejectedGrantToken(value: string | undefined): string | undefined {
  if (value !== undefined && (!nonempty(value) || value.length > 16384)) {
    throw new LodySdkError('invalid_argument');
  }
  return value;
}
