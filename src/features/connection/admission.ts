import type { SessionMetadata } from '@lody-mobile/sdk';
import * as v from 'valibot';

import { turnSchema } from '../conversations/admission';

const projectSchema = v.variant('kind', [
  v.object({ kind: v.literal('github'), repoFullName: v.string(), branch: v.string() }),
  v.object({
    kind: v.literal('local'),
    localProjectId: v.string(),
    branch: v.exactOptional(v.string()),
    githubRepoFullName: v.exactOptional(v.string()),
    useWorktree: v.exactOptional(v.boolean()),
  }),
]);
const metadataSchema = v.object({
  id: v.string(),
  machineId: v.string(),
  userId: v.string(),
  createdAt: v.string(),
  isArchived: v.boolean(),
  agentConfigId: v.string(),
  cliType: v.exactOptional(v.picklist(['builtin', 'registry', 'custom'])),
  agentType: v.exactOptional(v.string()),
  status: v.exactOptional(v.object({ type: v.literal('idle') })),
  historyBackend: v.exactOptional(v.literal('loro')),
  lastMessageAt: v.exactOptional(v.number()),
  title: v.exactOptional(v.string()),
  titleSource: v.exactOptional(v.picklist(['user', 'generated', 'draft'])),
  repoFullName: v.exactOptional(v.string()),
  baseBranch: v.exactOptional(v.string()),
  isWorktree: v.exactOptional(v.boolean()),
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
    return (
      left.localProjectId === right.localProjectId &&
      left.branch === right.branch &&
      left.githubRepoFullName === right.githubRepoFullName &&
      left.useWorktree === right.useWorktree
    );
  return false;
}
export function sameMetadata(left: SessionMetadata, right: SessionMetadata) {
  return (
    left.id === right.id &&
    left.userId === right.userId &&
    left.createdAt === right.createdAt &&
    left.machineId === right.machineId &&
    left.agentConfigId === right.agentConfigId &&
    (!left.cliType || !right.cliType || left.cliType === right.cliType) &&
    (!left.agentType || !right.agentType || left.agentType === right.agentType) &&
    sameProject(left.project, right.project)
  );
}
