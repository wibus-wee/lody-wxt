import * as v from 'valibot';

import { FILE_MAX_BYTES, IMAGE_MAX_BYTES } from '../domain/attachments.js';

const identifier = v.pipe(v.string(), v.regex(/^[\w-]{1,128}$/));
const name = v.pipe(v.string(), v.minLength(1));
const size = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(FILE_MAX_BYTES));
const hash = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/));
export const fileAttachmentSchema = v.object({
  type: v.literal('file'),
  fileId: identifier,
  fileName: name,
  mimeType: name,
  sizeBytes: size,
  sha256: hash,
  textPreview: v.boolean(),
  transport: v.literal('r2'),
  uploadedAt: v.pipe(v.number(), v.minValue(0), v.finite()),
  storageSessionId: v.optional(identifier),
});
export const imageAttachmentSchema = v.object({
  type: v.literal('image'),
  imageId: identifier,
  mimeType: v.picklist(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  fileName: v.optional(name),
  sizeBytes: v.pipe(size, v.maxValue(IMAGE_MAX_BYTES)),
  width: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  height: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  storageSessionId: v.optional(identifier),
});
