import { fromByteArray, toByteArray } from 'base64-js';
import * as v from 'valibot';
export { validDocumentId } from '../domain/document-id.js';

export const DATA_PROTOCOL = 3;
export const MAX_BINARY_BYTES = 1024 * 1024;
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

export function encodeBinary(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BINARY_BYTES)
    throw new BridgeError('invalid_input');
  return fromByteArray(bytes);
}

const binaryTextSchema = v.pipe(
  v.string(),
  v.maxLength(Math.ceil(MAX_BINARY_BYTES / 3) * 4),
  v.check((value) => value.length % 4 === 0),
);
export function decodeBinary(value: unknown): Uint8Array {
  const result = v.safeParse(binaryTextSchema, value);
  if (!result.success) throw new BridgeError('invalid_input');
  const bytes = toByteArray(result.output);
  // The library also accepts URL-safe/noncanonical input; the wire contract does not.
  if (bytes.length > MAX_BINARY_BYTES || fromByteArray(bytes) !== result.output)
    throw new BridgeError('invalid_input');
  return bytes;
}

/** Distinguishes controlled bridge failures from raw engine exceptions. */
export class BridgeError extends Error {}
const recordSchema = v.looseObject({});
export const record = (value: unknown) => v.is(recordSchema, value);
// JSON serialization accepts arbitrary caller values; encoded text is validated before transport.
// ast-grep-ignore: no-unknown-parameter
export function stringifyMessage(value: unknown): string {
  const text = JSON.stringify(value);
  if (!v.is(v.string(), text) || utf8Size(text) > MAX_MESSAGE_BYTES)
    throw new BridgeError('limit_exceeded');
  return text;
}
function utf8Size(text: string): number {
  // RN/Hermes need not provide TextEncoder; count UTF-8 without a platform dependency.
  let size = 0;
  for (const char of text) {
    const n = char.codePointAt(0)!;
    size += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4;
  }
  return size;
}
export function parseMessage(text: string): Record<string, unknown> {
  if (!v.is(v.string(), text) || utf8Size(text) > MAX_MESSAGE_BYTES)
    throw new BridgeError('invalid_response');
  try {
    const value: unknown = JSON.parse(text);
    if (record(value)) return value;
  } catch {
    /* Classified below. */
  }
  throw new BridgeError('invalid_response');
}
