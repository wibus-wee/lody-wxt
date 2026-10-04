import * as v from 'valibot';

import { readLocal, writeLocal } from '../../shared/storage';

const workflowSchema = v.strictObject({
  id: v.string(),
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  prompt: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(128000)),
  includeCurrentPage: v.boolean(),
  updatedAt: v.number(),
});
export type Workflow = v.InferOutput<typeof workflowSchema>;
const workflowsSchema = v.array(workflowSchema);
export const automationScope = (accountKey: string, workspaceId: string) =>
  JSON.stringify([accountKey, workspaceId]);
const workflowKey = (scope: string) => `automation:workflows:${scope}`;
export async function loadWorkflows(scope: string): Promise<Workflow[]> {
  const value = await readLocal(workflowKey(scope));
  return value == null ? [] : v.parse(workflowsSchema, value);
}
export async function saveWorkflow(scope: string, workflow: Workflow): Promise<void> {
  await navigator.locks.request(workflowKey(scope), async () => {
    const rows = await loadWorkflows(scope);
    const value = v.parse(workflowSchema, workflow);
    await writeLocal(workflowKey(scope), [...rows.filter((row) => row.id !== value.id), value]);
  });
}
export async function deleteWorkflow(scope: string, id: string): Promise<void> {
  await navigator.locks.request(workflowKey(scope), async () => {
    await writeLocal(
      workflowKey(scope),
      (await loadWorkflows(scope)).filter((row) => row.id !== id),
    );
  });
}

export async function importWorkflows(scope: string, incoming: Workflow[]): Promise<void> {
  await navigator.locks.request(workflowKey(scope), async () => {
    const rows = await loadWorkflows(scope);
    await writeLocal(workflowKey(scope), [...rows, ...v.parse(workflowsSchema, incoming)]);
  });
}
