import * as v from 'valibot';

import type { Workflow } from './storage';

const portableWorkflowSchema = v.strictObject({
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  prompt: v.pipe(v.string(), v.minLength(1), v.maxLength(128000)),
  includeCurrentPage: v.boolean(),
});
const transferSchema = v.strictObject({
  version: v.literal(1),
  workflows: v.pipe(v.array(portableWorkflowSchema), v.maxLength(100)),
});
const parameterPattern = /\{\{([\p{L}\p{N}_-]{1,40})\}\}/gu;
export function workflowParameters(prompt: string): string[] {
  return [...new Set(Array.from(prompt.matchAll(parameterPattern), (match) => match[1]!))];
}
export function fillWorkflowParameters(prompt: string, values: Record<string, string>): string {
  return prompt.replace(parameterPattern, (_match, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (!value?.trim()) throw new Error(`请填写参数：${name}`);
    return value;
  });
}
export function serializeWorkflows(workflows: readonly Workflow[]): string {
  return JSON.stringify(
    v.parse(transferSchema, {
      version: 1,
      workflows: workflows.map(({ title, prompt, includeCurrentPage }) => ({
        title,
        prompt,
        includeCurrentPage,
      })),
    }),
    null,
    2,
  );
}
export function parseWorkflowImport(text: string, now: number): Workflow[] {
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024)
    throw new Error('快捷指令导入文件不能超过 1 MiB。');
  const payload = v.parse(transferSchema, JSON.parse(text));
  return payload.workflows.map((workflow) => ({
    ...workflow,
    id: crypto.randomUUID(),
    updatedAt: now,
  }));
}
