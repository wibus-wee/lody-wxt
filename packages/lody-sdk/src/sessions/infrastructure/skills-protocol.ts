import * as v from 'valibot';

const id = v.pipe(v.string(), v.minLength(1));
const skillGroupSchema = v.object({
  scope: v.picklist(['project', 'global', 'system']),
  dir: v.string(),
  truncated: v.boolean(),
  skippedExternalSymlinks: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  error: v.exactOptional(v.string()),
  skills: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      description: v.exactOptional(v.string()),
      version: v.exactOptional(v.string()),
      author: v.exactOptional(v.string()),
      relativePath: v.string(),
      absolutePath: v.exactOptional(v.string()),
      isSymlink: v.boolean(),
      symlinkTarget: v.exactOptional(v.string()),
      content: v.exactOptional(v.string()),
    }),
  ),
});
const common = { machineId: id, workspaceId: id, requestedByUserId: v.exactOptional(id) };
export const skillRequestSchema = v.variant('type', [
  v.strictObject({ type: v.literal('local-project/list-global-skills'), ...common }),
  v.strictObject({
    type: v.literal('local-project/list-skills'),
    ...common,
    localProjectId: id,
    skillDirs: v.array(id),
  }),
]);
export const skillResultSchema = v.variant('ok', [
  v.object({
    ok: v.literal(true),
    type: v.picklist(['local-project/list-skills', 'local-project/list-global-skills']),
    result: v.object({
      groups: v.array(skillGroupSchema),
      contentFingerprint: v.exactOptional(v.string()),
    }),
  }),
  v.object({
    ok: v.literal(false),
    type: v.picklist(['local-project/list-skills', 'local-project/list-global-skills']),
    error: v.string(),
    message: v.exactOptional(v.string()),
  }),
]);
