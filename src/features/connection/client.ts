import type { MessageActivity } from '../../shared/ui/MessageSurface';
import type { PageContext } from '../page-context/model';
import type { PermissionOption, RunConfig, RunModel } from './run-config';

export interface ExecutionTarget {
  workspaceId: string;
  machineId: string;
  agentConfigId: string;
  project: { kind: 'chat' } | { kind: 'github'; repo: string };
}

export interface Message {
  id: string;
  role: 'user' | 'agent';
  text: string;
  contexts: PageContext[];
  status: 'complete' | 'streaming' | 'stopped' | 'failed';
  inputConfig?: RunConfig | undefined;
  createdAt?: number | undefined;
  endedAt?: number | undefined;
  activities?: MessageActivity[] | undefined;
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
  fail: boolean;
  retry: boolean;
  project?: ExecutionTarget['project'];
  inputConfig?: RunConfig | undefined;
}

export interface LodyClient {
  readonly accountKey: string;
  readonly capabilities: { cancel: boolean; approvals: false; pageActions: false };
  readonly runModels: readonly RunModel[];
  readonly permissionModes: readonly PermissionOption[];
  list: () => Promise<Conversation[]>;
  create: (target: ExecutionTarget) => Promise<Conversation>;
  send: (input: SendInput) => Promise<void>;
  stop: (sessionId: string) => Promise<void>;
}

export const connectionBlocker =
  '真实连接不可用：当前上游没有扩展登录 / 配对接口。需要浏览器授权、工作区目录、会话命令及历史订阅适配；不会回退到演示数据。';

export function unavailableClient(workspaceId: string): LodyClient {
  const unavailable = () => Promise.reject(new Error(connectionBlocker));
  return {
    accountKey: `real:${workspaceId}`,
    capabilities: { cancel: false, approvals: false, pageActions: false },
    runModels: [],
    permissionModes: [],
    list: unavailable,
    create: unavailable,
    send: unavailable,
    stop: unavailable,
  };
}
