import type { SessionMetadata, TurnInput } from './runtime.js';
import type { ProjectRef } from './submission.js';

export interface SessionMetadataInput {
  id: string;
  machineId: string;
  userId: string;
  createdAt: string;
  agentConfigId: string;
  cliType: TurnInput['cliType'];
  agentType: string;
  project?: ProjectRef;
  title?: string;
  titleSource?: SessionMetadata['titleSource'];
  lastMessageAt?: number;
}

/** Creation policy matches Lody's session-submission; callers own identity and clock. */
export function buildSessionMetadata(input: SessionMetadataInput): SessionMetadata {
  const project = input.project ? { ...input.project } : undefined;
  const repoFullName = (
    project?.kind === 'github' ? project.repoFullName : project?.githubRepoFullName
  )?.trim();
  const baseBranch = project?.kind === 'github' ? project.branch.trim() : undefined;
  const title = input.title?.trim();
  return {
    id: input.id,
    machineId: input.machineId,
    userId: input.userId,
    createdAt: input.createdAt,
    agentConfigId: input.agentConfigId,
    cliType: input.cliType,
    agentType: input.agentType,
    status: { type: 'idle' },
    historyBackend: 'loro',
    isArchived: false,
    ...(project ? { project } : {}),
    ...(repoFullName ? { repoFullName } : {}),
    ...(baseBranch ? { baseBranch } : {}),
    ...(project?.kind === 'github' || project?.useWorktree === true ? { isWorktree: true } : {}),
    ...(title ? { title, titleSource: input.titleSource ?? 'user' } : {}),
    ...(input.lastMessageAt === undefined ? {} : { lastMessageAt: input.lastMessageAt }),
  };
}
