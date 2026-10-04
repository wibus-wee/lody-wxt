import * as v from 'valibot';

const commandSchema = v.object({
  type: v.literal('terminal_command'),
  command: v.string(),
  args: v.optional(v.array(v.string())),
  cwd: v.optional(v.string()),
});
const textSchema = v.object({ type: v.literal('text'), text: v.string() });
const outputSchema = v.variant('type', [
  textSchema,
  v.object({ type: v.literal('terminal_output'), output: v.string() }),
  v.object({ type: v.literal('output'), output: v.unknown() }),
  v.object({ type: v.literal('content'), content: textSchema }),
]);
const contentSchema = v.object({
  content: v.optional(v.array(v.unknown()), []),
  rawInput: v.optional(v.unknown()),
  rawOutput: v.optional(v.unknown()),
  command: v.optional(v.string()),
  output: v.optional(v.string()),
});

// Stored tool blocks are an open protocol boundary; known variants are decoded independently.
export function toolContent(item: unknown) {
  const parsed = v.safeParse(contentSchema, item);
  if (!parsed.success) return {};
  const commands: string[] = [];
  const outputs: string[] = [];
  for (const block of parsed.output.content) {
    const command = v.safeParse(commandSchema, block);
    if (command.success) {
      const { cwd, command: executable, args = [] } = command.output;
      commands.push([cwd, [executable, ...args].join(' ')].filter(Boolean).join('\n'));
      continue;
    }
    const output = v.safeParse(outputSchema, block);
    if (!output.success) continue;
    const value = output.output;
    if (value.type === 'text') outputs.push(value.text);
    else if (value.type === 'content') outputs.push(value.content.text);
    else {
      const text = v.safeParse(v.string(), value.output);
      outputs.push(text.success ? text.output : JSON.stringify(value.output, null, 2));
    }
  }
  const data = parsed.output;
  return {
    command:
      commands.join('\n') ||
      data.command ||
      (data.rawInput ? JSON.stringify(data.rawInput, null, 2) : undefined),
    output:
      outputs.join('\n') ||
      data.output ||
      (data.rawOutput ? JSON.stringify(data.rawOutput, null, 2) : undefined),
  };
}
