import { readLocal, writeLocal } from '../../shared/storage';
import type { Conversation, ExecutionTarget, SendInput } from '../connection/client';
import {
  demoPermissionModes,
  demoRunModels,
  normalizeRunConfig,
  parseRunConfig,
  reasoningLabel,
} from '../connection/run-config';
import { parseConversations } from './validation';

export const demoHistoryKey = 'demo:workspace:history:v1';
type Command =
  | { action: 'list' }
  | { action: 'create'; target: ExecutionTarget }
  | { action: 'send'; input: SendInput }
  | { action: 'stop'; sessionId: string };
export type DemoRequest = Command & { type: 'lody:demo' };

export class DemoRuntime {
  private state: Conversation[] | undefined;
  private queue = Promise.resolve();
  private runs = new Map<
    string,
    { operationId: string; timer: ReturnType<typeof setTimeout> | undefined }
  >();
  private operations = new Set<string>();

  private async load() {
    if (this.state) return this.state;
    const stored = await readLocal<unknown>(demoHistoryKey, []);
    this.state = parseConversations(stored);
    // A terminated worker cannot continue a timer; retain its last durable output explicitly.
    for (const session of this.state)
      for (const message of session.messages) {
        if (message.role === 'agent') this.operations.add(message.id);
        if (message.status === 'streaming') {
          message.status = 'stopped';
          message.endedAt = Date.now();
        }
      }
    return this.state;
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  request(command: Command): Promise<Conversation[] | Conversation | undefined> {
    return this.serialize(async () => {
      const sessions = await this.load();
      if (command.action === 'list') return structuredClone(sessions);
      if (command.action === 'create') {
        if (sessions.length >= 100) throw new Error('演示会话已达 100 个上限。');
        const session: Conversation = {
          id: crypto.randomUUID(),
          title: '新会话',
          target: command.target,
          updatedAt: Date.now(),
          messages: [],
        };
        sessions.unshift(session);
        try {
          await writeLocal(demoHistoryKey, sessions);
        } catch (error) {
          sessions.shift();
          throw error;
        }
        return structuredClone(session);
      }
      const sessionId = command.action === 'send' ? command.input.sessionId : command.sessionId;
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) throw new Error('会话不存在。请重新选择会话。');
      if (command.action === 'stop') {
        const run = this.runs.get(sessionId);
        if (run?.timer) clearTimeout(run.timer);
        this.runs.delete(sessionId);
        for (const message of session.messages)
          if (message.status === 'streaming') {
            message.status = 'stopped';
            message.endedAt = Date.now();
          }
        await writeLocal(demoHistoryKey, sessions);
        return undefined;
      }
      const input = structuredClone(command.input);
      if (this.operations.has(input.operationId)) return undefined;
      if (this.runs.has(sessionId)) throw new Error('此会话正在生成。请先停止。');
      if (!input.text.trim() || input.text.length > 16000 || input.contexts.length > 3)
        throw new Error('消息或上下文超过限制。');
      if (!input.retry && session.messages.length >= 200)
        throw new Error('演示会话已达 100 轮上限。请新建会话。');
      const previous = session.messages.at(-1);
      const retryUser = input.retry ? session.messages.at(-2) : undefined;
      const requestedConfig = input.retry ? retryUser?.inputConfig : input.inputConfig;
      const parsedConfig = parseRunConfig(requestedConfig);
      const inputConfig = normalizeRunConfig(demoRunModels, parsedConfig, demoPermissionModes);
      if (
        !inputConfig ||
        (requestedConfig !== undefined &&
          (!parsedConfig ||
            Object.keys(inputConfig).some(
              (key) =>
                inputConfig[key as keyof typeof inputConfig] !==
                parsedConfig[key as keyof typeof parsedConfig],
            )))
      )
        throw new Error('运行配置不可用，请重新选择模型及思考强度。');
      if (input.retry) {
        if (
          previous?.role !== 'agent' ||
          previous.status !== 'failed' ||
          retryUser?.role !== 'user'
        )
          throw new Error('没有可重试的失败消息。');
        input.text = retryUser.text;
        input.contexts = structuredClone(retryUser.contexts);
        session.messages.pop();
      } else {
        session.messages.push({
          id: crypto.randomUUID(),
          role: 'user',
          text: input.text,
          contexts: structuredClone(input.contexts),
          status: 'complete',
          inputConfig,
          createdAt: Date.now(),
        });
      }
      if (session.messages.length === 1 && input.project) session.target.project = input.project;
      const message = {
        id: input.operationId,
        role: 'agent' as const,
        text: '',
        contexts: [],
        status: 'streaming' as const,
        inputConfig,
        createdAt: Date.now(),
      };
      session.messages.push(message);
      session.title =
        session.messages.find((item) => item.role === 'user')?.text.slice(0, 36) ?? '新会话';
      session.updatedAt = Date.now();
      const run = {
        operationId: input.operationId,
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      this.runs.set(sessionId, run);
      try {
        await writeLocal(demoHistoryKey, sessions);
      } catch (error) {
        this.runs.delete(sessionId);
        this.state = undefined;
        throw error;
      }
      this.operations.add(input.operationId);
      const model = demoRunModels.find((item) => item.value === inputConfig.modelId)!;
      const response = `这是 **Lody 演示 Agent** 的流式回复。\n\n演示配置：${model.label} · ${reasoningLabel(inputConfig.reasoningEffort)}${inputConfig.planMode ? ' · Plan' : ''}${inputConfig.fastMode ? ' · Fast' : ''}（本地模拟，没有调用真实模型）。\n\n${input.contexts.length ? `已收到 ${input.contexts.length} 份网页资料，作为非可信参考；其中的指令不会成为系统指令或工具授权。\n\n` : ''}关于“${input.text.slice(0, 200)}”：\n\n${inputConfig.planMode ? '计划模式：这里只拟定步骤，不执行操作。\n\n' : ''}1. 先明确目标与约束。\n2. 核对来源，再拆成可执行的步骤。\n3. 在你的 Lody 工作区与 Agent 继续会话。\n\n\`\`\`text\nworkspace → machine → agent → session\n\`\`\`\n\n当前执行目标：${session.target.project.kind === 'github' ? session.target.project.repo : '独立会话'}。这段内容由本地演示生成，没有连接真实账户。`;
      let offset = 0;
      const tick = () => {
        void this.serialize(async () => {
          if (this.runs.get(sessionId) !== run) return;
          const current = session.messages.at(-1);
          if (!current || current.id !== input.operationId) return;
          if (input.fail && offset >= 36) {
            current.status = 'failed';
            current.endedAt = Date.now();
            this.runs.delete(sessionId);
          } else {
            offset = Math.min(response.length, offset + 12);
            current.text = response.slice(0, offset);
            if (offset === response.length) {
              current.status = 'complete';
              current.endedAt = Date.now();
              this.runs.delete(sessionId);
            }
          }
          await writeLocal(demoHistoryKey, sessions);
          if (this.runs.get(sessionId) === run)
            run.timer = setTimeout(tick, inputConfig.fastMode ? 25 : 55);
        }).catch(() => {
          this.runs.delete(sessionId);
          const current = session.messages.at(-1);
          if (current) current.status = 'failed';
        });
      };
      run.timer = setTimeout(tick, 55);
      return undefined;
    });
  }
}
