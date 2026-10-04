export interface ShareObject {
  id: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  contentEncoding?: 'zstd';
  decodedSizeBytes?: number;
}
export interface ShareConversation {
  id: string;
  title: string;
  historyObjectId: string;
  parentConversationId?: string;
  openedByConversationId?: string;
  childSessionPlacement?: 'side-panel';
}
export interface ShareAttachment {
  id: string;
  kind: 'image' | 'file';
  fileName: string;
  objectId: string;
}
export interface SharePackageManifest {
  formatVersion: 1 | 2;
  historyFormatVersion: 1;
  capturedAt: string;
  rootConversationId: string;
  conversations: ShareConversation[];
  attachments: ShareAttachment[];
  objects: ShareObject[];
}
export type ShareJson =
  | null
  | boolean
  | number
  | string
  | ShareJson[]
  | { [key: string]: ShareJson };
export type ShareHistoryEntry = { [key: string]: ShareJson } & {
  id: string;
  role: string;
  items?: ({ [key: string]: ShareJson } & { type: string })[];
};
export interface ShareSourceConversation {
  sourceId: string;
  title: string;
  history: unknown;
  parentSourceId?: string;
  openedBySourceId?: string;
  childSessionPlacement?: 'side-panel';
}
export interface PreparedSharePackage {
  manifest: SharePackageManifest;
  manifestBytes: Uint8Array;
  manifestHash: string;
  objects: ReadonlyMap<string, Uint8Array>;
  sourceIds: { sourceId: string; conversationId: string }[];
}
export interface ShareAttachmentSource {
  conversationSourceId: string;
  kind: 'image' | 'file';
  reference: Readonly<Record<string, ShareJson>>;
}
export interface SessionShareView {
  shareId: string;
  rootSessionId: string;
  publisherUserId: string;
  status: 'draft' | 'active' | 'revoked';
  revision: number;
  credentialVersion: number;
  currentDeploymentId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}
export interface SessionShareManagementEntry extends SessionShareView {
  sourceIds: { sourceId: string; conversationId: string }[];
  selectedSourceIds: string[];
  canManage: boolean;
  canRevoke: boolean;
}
export interface PublishedSessionShare extends Omit<SessionShareView, 'status'> {
  status: 'active' | 'revoked';
  totalBytes: number;
  conversationCount: number;
  canManage: boolean;
  canRevoke: boolean;
}
export interface PublishedSessionSharePage {
  page: PublishedSessionShare[];
  isDone: boolean;
  continueCursor: string;
}
export interface BeginShareDeployment {
  workspaceId: string;
  rootSessionId: string;
  shareId?: string;
  expectedRevision?: number;
  credentialHash?: string;
  uploadCredentialHash: string;
  requestId: string;
  manifest: SharePackageManifest;
  sourceIds: { sourceId: string; conversationId: string }[];
}
export interface ShareRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
