import type { ProjectRef, SubmissionInputBlock } from './submission.js';

export interface TurnInput {
  prompt: string;
  cliType: 'builtin' | 'registry' | 'custom';
  agentType: string;
  inputBlocks?: SubmissionInputBlock[];
  modelId?: string;
  modeId?: string;
  mcpServerIds?: string[];
  configOptionValues?: Record<string, string | boolean>;
}

export interface SessionTurn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  userId?: string;
  status?: string;
  finished?: boolean;
  inputConfig?: Partial<TurnInput>;
  items?: unknown[];
  [key: string]: unknown;
}

export interface SessionMetadata {
  id: string;
  machineId: string;
  userId: string;
  createdAt: string;
  isArchived: boolean;
  title?: string;
  project?: ProjectRef;
  latestUserMsgId?: string;
  [key: string]: unknown;
}

export interface SessionSnapshot {
  sessionId: string;
  history: SessionTurn[];
  queue: SessionQueueItem[];
  session: Record<string, unknown>;
}

export interface SessionQueueItem {
  task: string;
  userId: string;
  timestamp: string;
  userTurnId?: string;
  operationId?: string;
  isEditing?: boolean;
  editingStartedAt?: number;
  acpSessionConfig?: Partial<TurnInput>;
  [key: string]: unknown;
}

export interface SendTurn {
  requestId: string;
  timestamp: string;
  userId: string;
  inputConfig: TurnInput;
}
