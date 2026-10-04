import * as v from 'valibot';

const toolSchema = v.looseObject({
  type: v.literal('tool_call'),
  toolCallId: v.string(),
  title: v.nullish(v.string()),
  kind: v.optional(v.string()),
  status: v.optional(v.string()),
  activityKind: v.optional(v.string()),
  locations: v.optional(v.array(v.object({ path: v.optional(v.string()) }))),
  content: v.optional(v.array(v.looseObject({ type: v.string(), path: v.optional(v.string()) }))),
});
const proseSchema = v.variant('type', [
  v.object({ type: v.literal('text'), text: v.string() }),
  v.object({ type: v.literal('thought'), text: v.string() }),
  v.object({ type: v.literal('proposed_plan'), markdown: v.string() }),
]);
const retainedTypes = v.picklist([
  'file',
  'image',
  'image_group',
  'plan',
  'goal',
  'system_notice',
  'subagent_task',
  'available_commands',
]);
export type MessageContent =
  | v.InferOutput<typeof toolSchema>
  | v.InferOutput<typeof proseSchema>
  | { type: v.InferOutput<typeof retainedTypes> | 'unsupported'; raw: unknown };

// An open protocol boundary: unimplemented and malformed items remain inspectable.
export function readConversationContent(items: readonly unknown[]): MessageContent[] {
  return items.map((raw) => {
    const prose = v.safeParse(proseSchema, raw);
    if (prose.success) return prose.output;
    const tool = v.safeParse(toolSchema, raw);
    if (tool.success) return tool.output;
    const retained = v.safeParse(v.object({ type: retainedTypes }), raw);
    return { type: retained.success ? retained.output.type : 'unsupported', raw };
  });
}
