import type { SessionTurn } from '@lody-mobile/sdk';

import type { AgentIdentity } from '../../shared/icons/agent-identity';

export interface PageContext {
  id: string;
  kind: 'page' | 'selection';
  title: string;
  url: string;
  text: string;
  trust: 'untrusted';
}
export interface RunConfig {
  modelId: string;
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
  messages: Message[];
}
export interface SendInput {
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
}
export interface ClientSnapshot {
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
  permissionModes: readonly PermissionOption[];
  busy: boolean;
  gatewayOrigin?: string;
  admission?: {
    sessionId: string;
    phase: 'metadata-unconfirmed' | 'awaiting-first-turn' | 'delivery-unconfirmed';
    operationId?: string;
  } | null;
  modelConfigOptions?: Record<string, NonNullable<ClientSnapshot['configOptions']>>;
  configOptions?: readonly {
    id: string;
    name: string;
    type: 'select' | 'boolean';
    currentValue: string | boolean;
    options: readonly { value: string | boolean; name: string }[];
  }[];
}
export interface LodyClient {
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
  selectTarget: (target: ExecutionTarget) => Promise<void>;
  refreshCapabilities: () => Promise<void>;
  recoverDelivery: () => Promise<boolean>;
  create: (target: ExecutionTarget) => Promise<Conversation>;
  start: (target: ExecutionTarget, input: Omit<SendInput, 'sessionId'>) => Promise<Conversation>;
  send: (input: SendInput) => Promise<void>;
  stop: (sessionId: string) => Promise<void>;
  respondPermission: (
    sessionId: string,
    turnId: string,
    requestId: string,
    optionId: string | null,
  ) => Promise<void>;
}
