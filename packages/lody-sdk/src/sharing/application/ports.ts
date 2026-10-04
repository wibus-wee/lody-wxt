import type {
  BeginShareDeployment,
  PublishedSessionSharePage,
  SessionShareManagementEntry,
  SessionShareView,
  ShareRequestOptions,
} from '../domain/models.js';

export interface ShareManagementPort {
  list: (
    workspaceId: string,
    pagination: { numItems: number; cursor: string | null },
    options?: ShareRequestOptions,
  ) => Promise<PublishedSessionSharePage>;
  getManagement: (
    workspaceId: string,
    rootSessionId: string,
    shareId?: string,
    options?: ShareRequestOptions,
  ) => Promise<SessionShareManagementEntry | null>;
  beginDeployment: (
    input: BeginShareDeployment,
    options?: ShareRequestOptions,
  ) => Promise<SessionShareView & { deploymentId: string }>;
  publishDeployment: (
    deploymentId: string,
    options?: ShareRequestOptions,
  ) => Promise<SessionShareView>;
  resetCredential: (
    input: { shareId: string; expectedRevision: number; credentialHash: string },
    options?: ShareRequestOptions,
  ) => Promise<SessionShareView>;
  revoke: (
    input: { shareId: string; expectedRevision: number },
    options?: ShareRequestOptions,
  ) => Promise<SessionShareView>;
}
