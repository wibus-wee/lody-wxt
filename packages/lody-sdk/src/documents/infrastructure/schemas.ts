import * as v from 'valibot';

import { validDocumentId } from '../domain/document-id.js';
import { decodeBinary } from './wire.js';

const binary = v.pipe(
  v.string(),
  v.check((value) => {
    try {
      decodeBinary(value);
      return true;
    } catch {
      return false;
    }
  }),
);
const environmentSchema = v.looseObject({
  origin: v.nullable(v.string()),
  userAgent: v.nullable(v.string()),
});
const changeSchema = v.object({
  documentId: v.pipe(
    v.string(),
    v.check((value) => validDocumentId(value)),
  ),
  revision: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
});
const readSchema = v.pipe(
  v.looseObject({
    kind: v.picklist(['loro', 'flock']),
    value: v.unknown(),
    version: binary,
    revision: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  }),
  v.check((value) => Object.hasOwn(value, 'value')),
);
const exportSchema = v.looseObject({ bytes: binary, version: binary });
const documentId = v.pipe(
  v.string(),
  v.check((value) => validDocumentId(value)),
);
const requestSchemas = {
  open: v.strictObject({ documentId, kind: v.picklist(['loro', 'flock']) }),
  import: v.strictObject({ documentId, bytes: binary }),
  read: v.strictObject({ documentId }),
  export: v.strictObject({ documentId, from: v.exactOptional(binary) }),
};

// Decode caller input with the schema selected by the requested bridge method.
// ast-grep-ignore: no-unknown-parameter
export function parseRequest(method: string, value: unknown) {
  const parsed = v.safeParse(v.picklist(['open', 'import', 'read', 'export']), method);
  if (!parsed.success) throw new Error('invalid_input');
  const input = v.safeParse(requestSchemas[parsed.output], value);
  if (!input.success) throw new Error('invalid_input');
  return input.output;
}

function parse<T>(schema: v.GenericSchema<unknown, T>, value: unknown): T {
  const result = v.safeParse(schema, value);
  if (!result.success) throw new Error('invalid_response');
  return result.output;
}

export const parseEnvironment = (value: unknown) => {
  const environment = parse(environmentSchema, value);
  return Object.freeze(environment);
};
export const parseChange = (value: unknown) => parse(changeSchema, value);

export function validateResult(method: string, value: unknown): void {
  if (new Set(['open', 'import']).has(method)) parse(v.null(), value);
  else if (method === 'export') parse(exportSchema, value);
  else if (method === 'read') parse(readSchema, value);
  else throw new Error('invalid_response');
}
