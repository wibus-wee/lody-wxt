import type {
  AttachmentRequestOptions,
  BeginShareDeployment,
  PreparedSharePackage,
  PromptShortcut,
  PromptShortcutIndexEntry,
  PromptShortcutScope,
  ScheduleEnable,
  ScheduleRepository,
  ScheduleRunRequest,
  ScheduleSave,
  SessionQueueItem,
  SessionTurn,
  ShareManagementPort,
  ShareRequestOptions,
  ShortcutRuntimeSnapshot,
  SubmissionInputBlock,
  WorkspaceMcpServer,
} from '@lody-mobile/sdk';

import type { AgentIdentity } from '../../shared/icons/agent-identity';

export interface PageContext {
  id: string;
  kind: 'page' | 'selection' | 'link';
  capturedAt?: string;
  truncated?: boolean;
  sourceLength?: number;
  tabId?: number;
  frameId?: number;
  documentId?: string;
  sourceRevision?: string;
  title: string;
  url: string;
  text: string;
  trust: 'untrusted';
}
export interface RunConfig {
  mcpServerIds?: string[];
  modelId?: string | undefined;
  reasoningEffort: string;
  planMode: boolean;
  fastMode: boolean;
  modeId?: string | undefined;
  configOptionValues?: Record<string, string | boolean> | undefined;
}
interface RunModel {
  value: string;
  label: string;
  reasoningEfforts: readonly string[];
  planMode: boolean;
  fastMode: boolean;
}
interface PermissionOption {
  value: string;
  label: string;
  description?: string | undefined;
  icon: 'permission' | 'readOnly' | 'permissionWarning';
}
export interface ExecutionTarget {
  workspaceId: string;
  machineId: string;
  agentConfigId: string;
  project:
    | { kind: 'chat' }
    | { kind: 'github'; repo: string; branch?: string }
    | { kind: 'local'; localProjectId: string; branch?: string };
}
interface MessageActivity {
  id: string;
  title: string;
  command?: string | undefined;
  output?: string | undefined;
  status: 'running' | 'complete' | 'failed';
  item: unknown;
  permissionRequest?: unknown;
}
export interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  contexts: PageContext[];
  status: 'complete' | 'streaming' | 'stopped' | 'failed';
  inputConfig?: RunConfig | undefined;
  createdAt?: number | undefined;
  endedAt?: number | undefined;
  activities: MessageActivity[];
  turn: SessionTurn;
}
export interface Conversation {
  id: string;
  title: string;
  target: ExecutionTarget;
  updatedAt: number;
  isArchived?: boolean;
  messages: Message[];
  queued?: SessionQueueItem[];
}
export type ChatAttachment = Exclude<SubmissionInputBlock, { type: 'text' }>;
export interface SendInput {
  attachments?: readonly ChatAttachment[];
  reservedSessionId?: string;
  sessionId: string;
  operationId: string;
  text: string;
  contexts: PageContext[];
  inputConfig?: RunConfig | undefined;
  fail?: boolean;
  retry?: boolean;
  project?: ExecutionTarget['project'];
}
interface MachineSummary {
  id: string;
  name: string | null;
  status?: 'online' | 'offline';
  schedules?: boolean;
  timeZone?: string;
}
export interface ClientSnapshot {
  availableCommands?: readonly { name: string; description?: string }[];
  mode: 'real';
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error: string | null;
  conversations: Conversation[];
  target: ExecutionTarget | null;
  machineIds: string[];
  selectedMachineId?: string;
  machines: MachineSummary[];
  agents: Array<{ id: string; name: string } & AgentIdentity>;
  runModels: readonly RunModel[];
  runConfigurationReady?: boolean;
  permissionModes: readonly PermissionOption[];
  busy: boolean;
  gatewayOrigin?: string;
  admission?: {
    sessionId: string;
    phase: 'metadata-unconfirmed' | 'awaiting-first-turn' | 'delivery-unconfirmed';
    operationId?: string;
  } | null;
  modelConfigOptions?: Record<string, NonNullable<ClientSnapshot['configOptions']>>;
  canSteer?: boolean;
  canFork?: boolean;
  configOptions?: readonly {
    id: string;
    name: string;
    category?: string | undefined;
    type: 'select' | 'boolean';
    currentValue: string | boolean;
    options: readonly {
      value: string | boolean;
      name: string;
      description?: string | null | undefined;
    }[];
  }[];
}
export interface ChatSchedules extends Pick<ScheduleRepository, 'list' | 'read' | 'runtimeRows'> {
  save: (input: Omit<ScheduleSave, 'actorId'>) => ReturnType<ScheduleRepository['save']>;
  setEnabled: (input: Omit<ScheduleEnable, 'actorId'>) => Promise<void>;
  requestRun: (input: Omit<ScheduleRunRequest, 'actorId'>) => Promise<void>;
  delete: (scheduleId: string) => Promise<void>;
}
export interface ChatSharing {
  verifyCredential: (shareId: string, secret: string) => Promise<void>;
  readonly publicOrigin: string | undefined;
  readonly apiOrigin: string | undefined;
  list: (pagination: {
    numItems: number;
    cursor: string | null;
  }) => ReturnType<ShareManagementPort['list']>;
  getManagement: (
    rootSessionId: string,
    shareId?: string,
  ) => ReturnType<ShareManagementPort['getManagement']>;
  prepare: (input: {
    rootSessionId: string;
    sessionIds: readonly string[];
    previousSourceIds?: readonly { sourceId: string; conversationId: string }[];
    capturedAt: string;
    signal?: AbortSignal;
  }) => Promise<PreparedSharePackage>;
  beginDeployment: (
    input: Omit<BeginShareDeployment, 'workspaceId'>,
    options?: ShareRequestOptions,
  ) => ReturnType<ShareManagementPort['beginDeployment']>;
  upload: (input: {
    deploymentId: string;
    secret: string;
    prepared: PreparedSharePackage;
    signal?: AbortSignal;
    onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  }) => Promise<void>;
  publishDeployment: ShareManagementPort['publishDeployment'];
  resetCredential: ShareManagementPort['resetCredential'];
  revoke: ShareManagementPort['revoke'];
}
export interface LodyClient {
  readonly shortcuts: ChatShortcuts;
  shortcutContext: () => { workspaceId: string; userId: string; scope: PromptShortcutScope };
  listMcpServers: () => Promise<WorkspaceMcpServer[]>;
  listSkills: () => Promise<
    Array<{
      scope: 'project' | 'global' | 'system';
      dir: string;
      truncated: boolean;
      error?: string;
      skills: Array<{
        id: string;
        name: string;
        description?: string;
        relativePath: string;
        absolutePath?: string;
      }>;
    }>
  >;
  readonly schedules: ChatSchedules;
  readonly sharing: ChatSharing;
  readonly accountKey: string;
  readonly mode: 'real';
  readonly error: string | null;
  readonly capabilities: { cancel: boolean; approvals: boolean; pageActions: false };
  readonly runModels: readonly RunModel[];
  readonly permissionModes: readonly PermissionOption[];
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ClientSnapshot;
  connect: () => Promise<void>;
  list: () => Promise<Conversation[]>;
  open: (sessionId: string) => Promise<void>;
  readConversation: (sessionId: string) => Promise<Conversation>;
  selectTarget: (target: ExecutionTarget) => Promise<void>;
  refreshCapabilities: () => Promise<void>;
  recoverDelivery: () => Promise<boolean>;
  create: (target: ExecutionTarget) => Promise<Conversation>;
  start: (target: ExecutionTarget, input: Omit<SendInput, 'sessionId'>) => Promise<Conversation>;
  send: (input: SendInput) => Promise<void>;
  rename: (sessionId: string, title: string) => Promise<void>;
  archive: (sessionId: string) => Promise<void>;
  restore: (sessionId: string) => Promise<void>;
  delete: (sessionId: string) => Promise<void>;
  fork: (
    sessionId: string,
    turnId: string,
    operationId: string,
    targetSessionId: string,
  ) => Promise<{ sessionId: string }>;
  edit: (input: SendInput, expectedUserTurnId: string) => Promise<void>;
  queue: (input: SendInput) => Promise<void>;
  steer: (input: SendInput, expectedTurnId: string) => Promise<void>;
  uploadAttachment: (
    storageSessionId: string,
    file: File,
    options?: AttachmentRequestOptions,
  ) => Promise<ChatAttachment>;
  downloadAttachment: (
    sessionId: string,
    attachment: ChatAttachment,
    options?: AttachmentRequestOptions,
  ) => Promise<Blob>;
  stop: (sessionId: string) => Promise<void>;
  respondPermission: (
    sessionId: string,
    turnId: string,
    requestId: string,
    optionId: string | null,
  ) => Promise<void>;
}

export interface ChatShortcuts {
  getSnapshot: () => ShortcutRuntimeSnapshot;
  subscribe: (listener: () => void) => () => void;
  connect: () => Promise<void>;
  retry: () => Promise<void>;
  read: (entry: PromptShortcutIndexEntry) => Promise<PromptShortcut>;
  save: (input: {
    value: PromptShortcut;
    base: PromptShortcutIndexEntry | null;
    bodyDocId: string;
  }) => Promise<PromptShortcutIndexEntry>;
  remove: (entry: PromptShortcutIndexEntry) => Promise<void>;
}
