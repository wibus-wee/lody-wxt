import * as v from 'valibot';

const idSchema = v.pipe(v.string(), v.minLength(1));
const text = v.strictObject({ type: v.literal('text'), text: v.string() });
const image = v.strictObject({
  type: v.literal('image'),
  imageId: idSchema,
  mimeType: v.picklist(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  sizeBytes: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5 * 1024 * 1024)),
  fileName: v.exactOptional(v.string()),
  width: v.exactOptional(v.number()),
  height: v.exactOptional(v.number()),
  storageSessionId: v.exactOptional(idSchema),
});
const file = v.strictObject({
  type: v.literal('file'),
  fileId: idSchema,
  fileName: idSchema,
  mimeType: v.string(),
  sizeBytes: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100 * 1024 * 1024)),
  sha256: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
  textPreview: v.boolean(),
  transport: v.literal('r2'),
  uploadedAt: v.number(),
  storageSessionId: v.exactOptional(idSchema),
});
const blocksSchema = v.pipe(
  v.array(v.variant('type', [text, image, file])),
  v.maxLength(17),
  v.check(
    (blocks) =>
      blocks.filter((block) => block.type === 'image').length <= 8 &&
      blocks.filter((block) => block.type === 'file').length <= 8,
  ),
);
const turnInputSchema = v.strictObject({
  prompt: v.string(),
  cliType: v.picklist(['builtin', 'registry', 'custom']),
  agentType: idSchema,
  inputBlocks: v.exactOptional(blocksSchema),
  modelId: v.exactOptional(idSchema),
  modeId: v.exactOptional(idSchema),
  mcpServerIds: v.exactOptional(v.array(v.pipe(v.string(), v.minLength(1)))),
  configOptionValues: v.exactOptional(v.record(v.string(), v.union([v.string(), v.boolean()]))),
});
const sendSchema = v.strictObject({
  requestId: idSchema,
  timestamp: v.pipe(v.string(), v.isoTimestamp()),
  userId: idSchema,
  inputConfig: turnInputSchema,
});
const historySchema = v.array(
  v.looseObject({
    id: idSchema,
    role: v.picklist(['user', 'assistant', 'system']),
    timestamp: v.string(),
    userId: v.exactOptional(v.string()),
    status: v.exactOptional(v.string()),
    finished: v.exactOptional(v.boolean()),
    inputConfig: v.exactOptional(v.looseObject({ prompt: v.exactOptional(v.string()) })),
    items: v.exactOptional(v.array(v.unknown())),
  }),
);
const documentSchema = v.looseObject({
  history: v.exactOptional(historySchema),
  mq: v.exactOptional(
    v.array(
      v.looseObject({
        task: v.string(),
        userId: idSchema,
        timestamp: v.string(),
        userTurnId: v.exactOptional(idSchema),
        operationId: v.exactOptional(idSchema),
        isEditing: v.exactOptional(v.boolean()),
        editingStartedAt: v.exactOptional(v.number()),
        acpSessionConfig: v.exactOptional(v.looseObject({ prompt: v.exactOptional(v.string()) })),
      }),
    ),
  ),
  session: v.exactOptional(v.record(v.string(), v.unknown())),
});
const metadataSchema = v.looseObject({
  id: idSchema,
  machineId: idSchema,
  userId: idSchema,
  createdAt: v.string(),
  isArchived: v.boolean(),
});
const permissionOutcomeSchema = v.variant('outcome', [
  v.looseObject({ outcome: v.literal('cancelled') }),
  v.looseObject({ outcome: v.literal('selected'), optionId: idSchema }),
]);
const permissionItemSchema = v.looseObject({
  type: v.literal('tool_call'),
  permissionRequest: v.looseObject({
    requestId: idSchema,
    options: v.array(v.looseObject({ optionId: idSchema })),
    outcome: v.exactOptional(permissionOutcomeSchema),
  }),
});
export {
  documentSchema,
  metadataSchema,
  permissionItemSchema,
  permissionOutcomeSchema,
  sendSchema,
};

// CRDT snapshots include future fields; canonicalization decodes their open JSON boundary.
// ast-grep-ignore: no-unknown-parameter
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = v.safeParse(v.record(v.string(), v.unknown()), value);
  if (record.success)
    return `{${Object.entries(record.output)
      .filter(([key, item]) => key !== '$cid' && item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
