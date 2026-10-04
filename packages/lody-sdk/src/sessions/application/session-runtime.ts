import type { SendTurn, SessionMetadata } from '../domain/runtime.js';
import type { MachineCommandPort, SessionRepository } from './runtime-ports.js';

export class SessionRuntime {
  constructor(
    private readonly repository: SessionRepository,
    private readonly commands: MachineCommandPort,
  ) {}

  createSession = (meta: SessionMetadata) => this.repository.create(meta);
  renameSession = (sessionId: string, title: string) =>
    this.repository.patch(sessionId, { title: title.trim(), titleSource: 'user' });
  respondPermission = async (
    sessionId: string,
    turnId: string,
    requestId: string,
    outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string },
  ) => {
    const handle = await this.repository.open(sessionId);
    try {
      await handle.respondPermission(turnId, requestId, outcome);
    } finally {
      await handle.close();
    }
  };
  listSessions = () => this.repository.list();
  subscribeSessions = (listener: () => void) => this.repository.subscribe(listener);
  openSession = (sessionId: string) => this.repository.open(sessionId);
  patchMetadata = (sessionId: string, patch: Partial<SessionMetadata>) =>
    this.repository.patch(sessionId, patch);

  send = async (sessionId: string, input: SendTurn, kind: 'dispatch' | 'queue' = 'dispatch') => {
    const handle = await this.repository.open(sessionId);
    try {
      await handle.append(input, kind);
      await handle.flush();
      return { sessionId, turnId: input.requestId, state: 'synced' as const };
    } finally {
      await handle.close();
    }
  };

  stop = (
    machineId: string,
    sessionId: string,
    turnId: string,
    requestId: string,
    signal?: AbortSignal,
  ) => this.commands.request(machineId, 'session/cancel', { sessionId, turnId }, requestId, signal);

  steer = (
    machineId: string,
    sessionId: string,
    expectedTurnId: string,
    input: SendTurn,
    signal?: AbortSignal,
  ) =>
    this.commands.request(
      machineId,
      'session/steer',
      {
        sessionId,
        expectedTurnId,
        userTurnId: input.requestId,
        userId: input.userId,
        timestamp: input.timestamp,
        inputConfig: input.inputConfig,
      },
      input.requestId,
      signal,
    );

  refreshCapabilities = (
    machineId: string,
    configId: string,
    requestId: string,
    signal?: AbortSignal,
  ) =>
    this.commands.request(
      machineId,
      'machine/acp-capabilities-refresh',
      { configId },
      requestId,
      signal,
    );

  fork = (
    machineId: string,
    spec: {
      sourceSessionId: string;
      sourceTurnId: string;
      targetSessionId: string;
      requestedByUserId: string;
      targetContext?: { kind: 'shared' } | { kind: 'new-worktree'; acknowledgeDirtySource?: true };
      targetPlacement?: 'side-panel';
    },
    requestId: string,
    signal?: AbortSignal,
  ) => this.commands.request(machineId, 'session/fork', spec, requestId, signal);

  editAndResend = (
    machineId: string,
    sessionId: string,
    expectedUserTurnId: string,
    input: SendTurn,
    signal?: AbortSignal,
  ) =>
    this.commands.request(
      machineId,
      'session/edit-and-resend',
      {
        sessionId,
        expectedUserTurnId,
        replacementUserTurnId: input.requestId,
        requestedByUserId: input.userId,
        timestamp: input.timestamp,
        inputConfig: input.inputConfig,
      },
      input.requestId,
      signal,
    );

  listSkills = (
    machineId: string,
    workspaceId: string,
    requestedByUserId: string,
    requestId: string,
    project?: { localProjectId: string; skillDirs: string[] },
    signal?: AbortSignal,
  ) =>
    this.commands.request(
      machineId,
      'local-project/control',
      {
        request: {
          type: project ? 'local-project/list-skills' : 'local-project/list-global-skills',
          machineId,
          workspaceId,
          requestedByUserId,
          ...(project
            ? { localProjectId: project.localProjectId, skillDirs: project.skillDirs }
            : {}),
        },
      },
      requestId,
      signal,
    );

  close = () => this.repository.close();
}
