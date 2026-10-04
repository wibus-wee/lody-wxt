import * as v from 'valibot';

import { LodySdkError } from '../../domain/errors.js';
import { httpsUrl, nonempty } from '../../domain/values.js';

export const nonemptyString = v.pipe(
  v.string(),
  v.check((value) => nonempty(value)),
);
export const positiveInteger = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const datePrefixPattern = /^\d{4}-\d{2}-\d{2}T/;
const dateString = v.pipe(
  v.string(),
  v.check((value) => datePrefixPattern.test(value) && Number.isFinite(Date.parse(value))),
);
export const authDateString = v.union([
  dateString,
  v.pipe(
    v.number(),
    v.safeInteger(),
    v.check((value) => Number.isFinite(new Date(value).getTime())),
    v.transform((value) => new Date(value).toISOString()),
  ),
]);
export const secureUrl = v.pipe(
  v.string(),
  v.check((value) => httpsUrl(value)),
);
export const secureBaseUrl = v.pipe(
  v.string(),
  v.check((value) => httpsUrl(value, true)),
);
export const recordSchema = v.record(v.string(), v.unknown());

/** Validation issues can contain input credentials; only the public error code may escape. */
export function parseResponse<T>(schema: v.GenericSchema<unknown, T>, value: unknown): T {
  const result = v.safeParse(schema, value);
  if (!result.success) throw new LodySdkError('invalid_response');
  return result.output;
}
