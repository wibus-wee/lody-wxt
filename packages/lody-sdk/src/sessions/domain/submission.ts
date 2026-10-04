export type ProjectRef =
  | { kind: 'github'; repoFullName: string; branch: string }
  | {
      kind: 'local';
      localProjectId: string;
      branch?: string;
      githubRepoFullName?: string;
      useWorktree?: boolean;
    };

export type SubmissionInputBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      imageId: string;
      storageSessionId?: string;
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
      fileName?: string;
      sizeBytes: number;
      width?: number;
      height?: number;
    }
  | {
      type: 'file';
      fileId: string;
      storageSessionId?: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      textPreview: boolean;
      transport: 'r2';
      uploadedAt: number;
    };

export interface SessionSubmission {
  requestId: string;
  machineId: string;
  agentConfigId: string;
  project?: ProjectRef;
  title: string;
  prompt: string;
  inputBlocks?: SubmissionInputBlock[];
  cliType: 'builtin' | 'registry' | 'custom';
  agentType: string;
  modelId?: string;
  modeId?: string;
  mcpServerIds?: string[];
  configOptionValues?: Record<string, string | boolean>;
}

export interface SubmissionReceipt {
  requestId: string;
  sessionId: string;
  turnId: string;
  state: 'pending' | 'submitted' | 'unconfirmed';
}

export class SubmissionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = 'SubmissionError';
  }
}
