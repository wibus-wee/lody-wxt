import type { SessionMetadata } from '@lody-mobile/sdk';
import * as v from 'valibot';

import { turnSchema } from '../conversations/admission';

const projectSchema = v.variant('kind', [
  v.object({ kind: v.literal('github'), repoFullName: v.string(), branch: v.string() }),
  v.object({
    kind: v.literal('local'),
    localProjectId: v.string(),
    branch: v.exactOptional(v.string()),
  }),
]);
const metadataSchema = v.object({
  id: v.string(),
  machineId: v.string(),
  userId: v.string(),
  createdAt: v.string(),
  isArchived: v.boolean(),
  agentConfigId: v.string(),
  project: v.exactOptional(projectSchema),
});
export const creationSchema = v.object({ scope: v.string(), metadata: metadataSchema });
export const firstTurnSchema = v.object({
  metadata: metadataSchema,
  input: turnSchema,
  state: v.picklist(['metadata-unconfirmed', 'metadata-synced', 'synced']),
});
function sameProject(left: SessionMetadata['project'], right: SessionMetadata['project']) {
  if (!left || !right) return left === right;
  if (left.kind === 'github' && right.kind === 'github')
    return left.repoFullName === right.repoFullName && left.branch === right.branch;
  if (left.kind === 'local' && right.kind === 'local')
    return left.localProjectId === right.localProjectId && left.branch === right.branch;
  return false;
}
export function sameMetadata(left: SessionMetadata, right: SessionMetadata) {
  return (
    left.id === right.id &&
    left.userId === right.userId &&
    left.createdAt === right.createdAt &&
    left.machineId === right.machineId &&
    left.agentConfigId === right.agentConfigId &&
    sameProject(left.project, right.project)
  );
}
