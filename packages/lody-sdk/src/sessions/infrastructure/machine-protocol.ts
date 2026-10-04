import * as v from 'valibot';

const idSchema = v.pipe(v.string(), v.minLength(1));
const modelControlsSchema = v.object({
  effortValues: v.exactOptional(v.array(v.string())),
  fastMode: v.exactOptional(v.boolean()),
});
export const modelCapabilitiesSchema = v.object({
  version: v.literal(1),
  sourceVersion: v.string(),
  models: v.pipe(
    v.record(v.string(), modelControlsSchema),
    v.check((models) => Object.keys(models).length > 0),
  ),
});
export const capabilitySchema = v.looseObject({
  cliType: v.picklist(['builtin', 'registry', 'custom']),
  agentType: v.string(),
  fetchedAt: v.number(),
  cacheVersion: v.exactOptional(v.number()),
  provenance: v.exactOptional(v.literal('runtime')),
  sourceVersion: v.exactOptional(v.string()),
  models: v.array(
    v.looseObject({
      modelId: v.string(),
      name: v.string(),
      description: v.exactOptional(v.nullable(v.string())),
    }),
  ),
  modes: v.array(
    v.looseObject({
      id: v.string(),
      name: v.string(),
      description: v.exactOptional(v.nullable(v.string())),
    }),
  ),
  configOptions: v.exactOptional(
    v.array(
      v.looseObject({
        id: v.string(),
        name: v.string(),
        type: v.picklist(['select', 'boolean']),
        currentValue: v.union([v.string(), v.boolean()]),
        options: v.array(
          v.looseObject({ value: v.union([v.string(), v.boolean()]), name: v.string() }),
        ),
      }),
    ),
  ),
  declaredModelControls: v.exactOptional(v.record(v.string(), modelControlsSchema)),
  acknowledgedSteer: v.exactOptional(v.boolean()),
  sessionFork: v.exactOptional(v.boolean()),
  sessionTitle: v.exactOptional(v.boolean()),
  sessionForkWorktree: v.exactOptional(v.boolean()),
  modelReasoningEfforts: v.exactOptional(v.record(v.string(), v.array(v.string()))),
  availableCommands: v.exactOptional(
    v.array(v.object({ name: idSchema, description: v.exactOptional(v.string()) })),
  ),
});

export const binaryProgressSchema = v.looseObject({
  type: v.literal('machine/acp-binary-progress'),
  machineId: idSchema,
  agentType: idSchema,
  status: v.picklist([
    'checking',
    'not-installed',
    'downloading',
    'verifying',
    'extracting',
    'publishing',
    'installed',
    'unsupported-platform',
    'incompatible-host',
    'error',
  ]),
  downloadedBytes: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  totalBytes: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  percent: v.exactOptional(v.pipe(v.number(), v.minValue(0), v.maxValue(100))),
});
export const refreshResultSchema = v.looseObject({
  type: v.literal('machine/acp-capabilities-refresh_response'),
  machineId: idSchema,
  configId: idSchema,
  cliType: v.picklist(['builtin', 'registry', 'custom']),
  agentType: idSchema,
  success: v.boolean(),
  capability: v.exactOptional(capabilitySchema),
  authRequired: v.exactOptional(v.boolean()),
  error: v.exactOptional(v.string()),
});
