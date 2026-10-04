import * as v from 'valibot';

const bytes = v.pipe(v.number(), v.integer(), v.minValue(0));
const imageFields = {
  imageId: v.pipe(v.string(), v.minLength(1)),
  mimeType: v.picklist(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  fileName: v.optional(v.string()),
  sizeBytes: bytes,
  storageSessionId: v.optional(v.string()),
};
const image = v.object({ type: v.literal('image'), ...imageFields });
const file = v.object({
  type: v.literal('file'),
  fileId: v.pipe(v.string(), v.minLength(1)),
  fileName: v.string(),
  mimeType: v.string(),
  sizeBytes: bytes,
  sha256: v.string(),
  textPreview: v.boolean(),
  transport: v.picklist(['r2', 'local']),
  machineId: v.optional(v.string()),
  uploadedAt: v.number(),
  storageSessionId: v.optional(v.string()),
});
export const specializedContentSchema = v.variant('type', [
  image,
  file,
  v.object({ type: v.literal('image_group'), images: v.array(v.object(imageFields)) }),
  v.object({
    type: v.literal('plan'),
    entries: v.array(
      v.object({
        content: v.string(),
        status: v.optional(v.picklist(['pending', 'in_progress', 'completed', 'cancelled'])),
        priority: v.optional(v.picklist(['high', 'medium', 'low'])),
      }),
    ),
  }),
  v.object({
    type: v.literal('goal'),
    objective: v.string(),
    status: v.picklist([
      'active',
      'paused',
      'blocked',
      'usageLimited',
      'budgetLimited',
      'complete',
      'cleared',
    ]),
  }),
  v.object({
    type: v.literal('available_commands'),
    commands: v.array(
      v.object({
        name: v.string(),
        description: v.optional(v.string()),
      }),
    ),
  }),
  v.object({
    type: v.literal('subagent_task'),
    taskId: v.string(),
    status: v.picklist(['pending', 'in_progress', 'completed', 'failed']),
    description: v.optional(v.string()),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    actor: v.optional(v.string()),
    run: v.optional(v.object({ sessionId: v.string(), items: v.array(v.unknown()) })),
  }),
  v.object({
    type: v.literal('system_notice'),
    name: v.picklist([
      'chat_failed',
      'agent_warning',
      'resume_from_external_chat_history',
      'session_fork_origin',
    ]),
    meta: v.optional(
      v.object({
        message: v.optional(v.string()),
        error: v.optional(v.string()),
        sourceTitle: v.optional(v.string()),
        sourceSessionId: v.optional(v.string()),
        truncated: v.optional(v.boolean()),
      }),
    ),
  }),
]);
export type ConversationAttachment = v.InferOutput<typeof image> | v.InferOutput<typeof file>;
export interface ConversationContentActions {
  loadAttachment?: (attachment: ConversationAttachment) => Promise<Blob>;
  onCommand?: (command: string) => void;
  onOpenSubagent?: (sessionId: string) => void;
}
