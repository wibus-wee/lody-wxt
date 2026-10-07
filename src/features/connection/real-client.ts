import type {
  AttachmentRequestOptions,
  ConvexCloudDirectory,
  LodyClient as SdkClient,
  ScheduleRepository,
  SendTurn,
  SessionHandle,
  SessionMetadata,
} from '@lody-mobile/sdk';
import {
  BetterAuthConvexJwtProvider,
  buildSessionMetadata,
  ConvexShareManagement,
  createAttachmentClient,
  openStaticShare,
  prepareSharePackage,
  skillResultSchema,
  uploadPreparedShare,
} from '@lody-mobile/sdk';
import type { createLoroSessionRuntime } from '@lody-mobile/sdk/loro';
import * as v from 'valibot';

import { agentIdentity } from '../../shared/icons/agent-identity';
import { SyncedShortcuts } from '../automations/shortcut-client';
import { contextInput, contextSchema, mapHistory } from '../chat/real-adapter';
import { turnSchema } from '../conversations/admission';
import {
  refreshMachineCapabilities,
  SessionAdmissionError,
  startSession,
  steerTurn,
} from '../conversations/session-flows';
import { creationSchema, firstTurnSchema, sameMetadata } from './admission';
import { connectBackgroundWorkspace } from './background-client';
import type {
  ChatAttachment,
  ChatSchedules,
  ChatSharing,
  ClientSnapshot,
  Conversation,
  ExecutionTarget,
  LodyClient,
  SendInput,
} from './client';
import {
  configurationOptionsForModel,
  resolveRunCapabilities,
  validateRunConfiguration,
} from './run-configuration';
import { requireApiAccess } from './state';
import { cloudFetch } from './worker-fetch';

type SdkConnection = Awaited<ReturnType<typeof createLoroSessionRuntime>>;
export type RealConnection = Pick<SdkConnection, 'runtime' | 'close'> & {
  schedules?: ScheduleRepository;
  mcpCatalog?: Pick<SdkConnection['mcpCatalog'], 'list'>;
  machines: Pick<SdkConnection['machines'], 'open'> &
    Partial<Pick<SdkConnection['machines'], 'listMachineInfos' | 'subscribeMachineInfos'>>;
};
type Connection = RealConnection;
type MachineHandle = Awaited<ReturnType<Connection['machines']['open']>>;
export interface RealClientOptions {
  accountKey: string;
  accountId: string;
  workspaceId: string;
  authOrigin: string;
  convexUrl: string;
  token: string;
  attachmentOrigin?: string;
  shareOrigin?: string;
  shareApiOrigin?: string;
  client: SdkClient;
  ports?: {
    createConnection?: (
      options: Parameters<typeof createLoroSessionRuntime>[0],
    ) => Promise<Connection>;
    directory?: Pick<ConvexCloudDirectory, 'listMachines'>;
    requireAccess?: typeof requireApiAccess;
  };
}
const targetPreferenceSchema = v.object({ machineId: v.string(), agentConfigId: v.string() });
const pendingSchema = v.object({
  sessionId: v.string(),
  input: turnSchema,
  contexts: v.array(contextSchema),
  kind: v.exactOptional(v.picklist(['edit', 'steer', 'queue'])),
  expectedTurnId: v.exactOptional(v.string()),
});
type Pending = v.InferOutput<typeof pendingSchema>;
class TurnRejectedError extends Error {}
function latestMessageTime(messages: Conversation['messages'], fallback: number) {
  return messages.reduce((time, message) => Math.max(time, message.createdAt ?? 0), fallback);
}

export class RealLodyClient implements LodyClient {
  readonly mode = 'real' as const;
  readonly capabilities = { cancel: true, approvals: true, pageActions: false } as const;
  readonly accountKey: string;
  readonly shortcuts: SyncedShortcuts;
  private state: ClientSnapshot = {
    mode: 'real',
    status: 'disconnected',
    error: null,
    conversations: [],
    target: null,
    machineIds: [],
    machines: [],
    agents: [],
    runModels: [],
    permissionModes: [],
    busy: false,
  };
  private listeners = new Set<() => void>();
  private connection: Connection | null = null;
  private machine: MachineHandle | null = null;
  private handle: SessionHandle | null = null;
  private selectedSessionId: string | undefined;
  private unlist: (() => void) | undefined;
  private unmachine: (() => void) | undefined;
  private unhistory: (() => void) | undefined;
  private lifecycle = new AbortController();
  private opening = 0;
  private selecting = 0;
  private listing = 0;
  private pending: Pending | null = null;
  private creation: v.InferOutput<typeof creationSchema> | null = null;
  private creationKey() {
    return `lody:real-create:${this.accountKey}`;
  }
  private firstTurnKey() {
    return `lody:real-admission:${this.accountKey}`;
  }
  private starting: Promise<void> | null = null;
  constructor(private readonly options: RealClientOptions) {
    this.accountKey = options.accountKey;
    this.shortcuts = new SyncedShortcuts({
      accountKey: options.accountKey,
      workspaceId: options.workspaceId,
      userId: options.accountId,
      authOrigin: options.authOrigin,
      convexOrigin: options.convexUrl,
      getToken: () => {
        this.active();
        return options.token;
      },
      ...(options.ports?.requireAccess ? { requireAccess: options.ports.requireAccess } : {}),
    });
    Object.defineProperty(this.sharing, 'publicOrigin', { get: () => this.options.shareOrigin });
    Object.defineProperty(this.sharing, 'apiOrigin', { get: () => this.options.shareApiOrigin });
  }
  get error() {
    return this.state.error;
  }
  get runModels() {
    return this.state.runModels;
  }
  get permissionModes() {
    return this.state.permissionModes;
  }
  getSnapshot = () => this.state;
  shortcutContext: LodyClient['shortcutContext'] = () => {
    this.active();
    const target = this.state.target;
    const agent = this.state.agents.find((row) => row.id === target?.agentConfigId);
    return {
      workspaceId: this.options.workspaceId,
      userId: this.options.accountId,
      scope: {
        ...(target ? { machineId: target.machineId } : {}),
        ...(agent?.cliType && agent.agentType
          ? { providerKey: `${agent.cliType}:${agent.agentType}` }
          : {}),
        ...(target?.project.kind === 'github'
          ? { project: { kind: 'github' as const, repository: target.project.repo } }
          : {}),
        ...(target?.project.kind === 'local'
          ? {
              project: {
                kind: 'local' as const,
                id: target.project.localProjectId,
                machineId: target.machineId,
              },
            }
          : {}),
      },
    };
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<ClientSnapshot>) {
    if (this.lifecycle.signal.aborted) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private active() {
    this.lifecycle.signal.throwIfAborted();
  }
  private required() {
    this.active();
    if (!this.connection) throw new Error('Connect a workspace first.');
    return this.connection;
  }
  private journalKey() {
    return `lody:real-turn:${this.accountKey}`;
  }
  // Promise rejection and caught protocol errors are untyped at this boundary.
  // ast-grep-ignore: no-unknown-parameter
  private report = (error: unknown) => {
    this.publish({ error: error instanceof Error ? error.message : String(error) });
  };
  private async connectRuntime() {
    const options = this.options;
    if (!options.ports && new Set(['chrome-extension:', 'moz-extension:']).has(location.protocol)) {
      const remote = await connectBackgroundWorkspace(
        {
          accountId: options.accountId,
          workspaceId: options.workspaceId,
          accountKey: options.accountKey,
          authOrigin: options.authOrigin,
          convexUrl: options.convexUrl,
          token: options.token,
        },
        this.lifecycle.signal,
        this.backgroundDisconnected,
      );
      this.publish({ gatewayOrigin: remote.gatewayOrigin });
      return remote;
    }
    const access = options.ports?.requireAccess ?? requireApiAccess;
    // Loaded on demand: an extension surface never reaches this branch, and keeping the
    // Loro runtime out of the static graph keeps its wasm glue out of the entry chunk.
    const { connectDirectWorkspace } = await import('./direct-workspace');
    const direct = await connectDirectWorkspace(
      {
        accountKey: this.accountKey,
        workspaceId: options.workspaceId,
        authOrigin: options.authOrigin,
        convexUrl: options.convexUrl,
        token: options.token,
        client: options.client,
        requireAccess: access,
        onGatewayOrigin: (origin) => this.publish({ gatewayOrigin: origin }),
        ports: options.ports,
      },
      this.lifecycle.signal,
    );
    return direct;
  }
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private backgroundDisconnected = (error: Error) => {
    if (this.lifecycle.signal.aborted) return;
    const selected = this.selectedSessionId;
    ++this.opening;
    ++this.selecting;
    ++this.listing;
    this.unlist?.();
    this.unhistory?.();
    this.unmachine?.();
    this.unlist = undefined;
    this.unhistory = undefined;
    this.unmachine = undefined;
    this.handle = null;
    this.machine = null;
    this.connection = null;
    this.publish({ status: 'error', error: error.message, runConfigurationReady: false });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.lifecycle.signal.aborted) return;
      void this.connect()
        .then(async () => {
          if (selected && this.state.conversations.some((row) => row.id === selected))
            await this.open(selected);
        })
        .catch(this.report);
    }, 500);
  };

  connect = () =>
    (this.starting ??= this.connectWorkspace().finally(() => {
      this.starting = null;
    }));
  private async connectWorkspace() {
    this.active();
    if (this.connection) return;
    this.publish({ status: 'connecting', error: null });
    const options = this.options;
    try {
      const access = options.ports?.requireAccess ?? requireApiAccess;
      await Promise.all([access(options.authOrigin), access(options.convexUrl)]);
      this.active();
      const { connection, machineIds } = await this.connectRuntime();
      if (this.lifecycle.signal.aborted) {
        await connection.close();
        return;
      }
      this.connection = connection;
      await this.restoreAdmission();
      this.unlist = connection.runtime.subscribeSessions(() => {
        void this.list().catch(this.report);
      });
      this.active();
      let reading = 0;
      const readMachines = async () => {
        const version = ++reading;
        const infos = await connection.machines.listMachineInfos?.(machineIds);
        this.active();
        if (version !== reading || this.connection !== connection) return;
        const byId = new Map(infos?.map((info) => [info.id, info]));
        this.publish({
          machines: machineIds.map((id) => ({
            id,
            name: byId.get(id)?.name?.trim() || null,
            schedules: (byId.get(id)?.protocolCapabilities?.schedules ?? 0) >= 1,
            ...(byId.get(id)?.timeZone ? { timeZone: byId.get(id)!.timeZone! } : {}),
          })),
        });
      };
      const unsubscribeMachines = connection.machines.subscribeMachineInfos?.(() => {
        void readMachines().catch(this.report);
      });
      const unsubscribeSessions = this.unlist;
      this.unlist = () => {
        ++reading;
        unsubscribeMachines?.();
        unsubscribeSessions?.();
      };
      await readMachines();
      this.publish({
        status: 'connected',
        machineIds,
        error: null,
      });
      await this.list();
      try {
        const saved = v.parse(
          v.nullable(targetPreferenceSchema),
          JSON.parse(localStorage.getItem(`lody:chat-target:${this.accountKey}`) ?? 'null'),
        );
        const machineId = saved?.machineId ?? (machineIds.length === 1 ? machineIds[0] : undefined);
        if (machineId && machineIds.includes(machineId))
          await this.selectTarget({
            workspaceId: options.workspaceId,
            machineId,
            agentConfigId: saved?.agentConfigId ?? '',
            project: { kind: 'chat' },
          });
        else if (saved) this.report(new Error('之前使用的机器已不可用，请重新选择对话助手。'));
      } catch (error) {
        this.report(error);
      }
    } catch (error) {
      if (!this.lifecycle.signal.aborted) {
        this.unlist?.();
        this.unlist = undefined;
        const connection = this.connection;
        this.connection = null;
        await connection?.close();
        this.report(error);
        this.publish({ status: 'error' });
        throw error;
      }
    }
  }
  private conversation(
    meta: SessionMetadata,
    messages: Conversation['messages'] = [],
    queued: NonNullable<Conversation['queued']> = [],
  ): Conversation {
    const project = meta.project;
    const agentId = v.safeParse(v.string(), meta.agentConfigId);
    const activity = v.safeParse(v.pipe(v.number(), v.finite()), meta.lastMessageAt);
    return {
      id: meta.id,
      isArchived: meta.isArchived,
      title:
        meta.title?.trim() ||
        messages.find((message) => message.role === 'user')?.text.slice(0, 80) ||
        '新对话',
      target: {
        workspaceId: this.options.workspaceId,
        machineId: meta.machineId,
        agentConfigId: agentId.success ? agentId.output : '',
        project:
          project?.kind === 'github'
            ? { kind: 'github', repo: project.repoFullName, branch: project.branch }
            : project?.kind === 'local'
              ? {
                  kind: 'local',
                  localProjectId: project.localProjectId,
                  ...(project.branch ? { branch: project.branch } : {}),
                }
              : { kind: 'chat' },
      },
      updatedAt: latestMessageTime(
        messages,
        Math.max(Date.parse(meta.createdAt), activity.success ? activity.output : 0),
      ),
      messages,
      queued,
    };
  }
  list = async () => {
    const connection = this.required();
    const listing = ++this.listing;
    const rows = await connection.runtime.listSessions();
    this.active();
    if (listing === this.listing)
      this.publish({
        ...(this.state.error?.startsWith('session_metadata_') ? { error: null } : {}),
        conversations: rows.map((meta) =>
          this.conversation(
            meta,
            this.state.conversations.find((row) => row.id === meta.id)?.messages,
            this.state.conversations.find((row) => row.id === meta.id)?.queued,
          ),
        ),
      });
    return this.state.conversations;
  };
  selectTarget = async (target: ExecutionTarget) => {
    const connection = this.required();
    const selecting = ++this.selecting;
    if (
      target.workspaceId !== this.options.workspaceId ||
      !this.state.machineIds.includes(target.machineId)
    )
      throw new Error('Select a visible workspace machine.');
    this.unmachine?.();
    this.unmachine = undefined;
    const old = this.machine;
    this.machine = null;
    this.publish({
      target: null,
      selectedMachineId: target.machineId,
      agents: [],
      runModels: [],
      runConfigurationReady: false,
      permissionModes: [],
      configOptions: [],
      availableCommands: [],
      canSteer: false,
      canFork: false,
      modelConfigOptions: {},
    });
    await old?.close();
    this.active();
    const machine = await connection.machines.open(target.machineId);
    if (this.lifecycle.signal.aborted || selecting !== this.selecting) {
      await machine.close();
      return;
    }
    this.machine = machine;
    const update = (snapshot: ReturnType<MachineHandle['read']>) => {
      if (selecting !== this.selecting) return;
      const agentId =
        target.agentConfigId || (snapshot.agents.length === 1 ? snapshot.agents[0]?.id : '');
      const agent = snapshot.agents.find((row) => row.id === agentId);
      const resolved = agent ? { ...target, agentConfigId: agent.id } : null;
      const caps = agent ? snapshot.capabilities[agent.id] : undefined;
      const catalog = caps ? resolveRunCapabilities(caps) : undefined;
      if (resolved) {
        try {
          localStorage.setItem(
            `lody:chat-target:${this.accountKey}`,
            JSON.stringify({
              machineId: resolved.machineId,
              agentConfigId: resolved.agentConfigId,
            }),
          );
        } catch (error) {
          this.report(error);
        }
      }
      this.publish({
        target: resolved,
        agents: snapshot.agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          ...agentIdentity(agent),
        })),
        canSteer: caps?.acknowledgedSteer === true,
        canFork: caps?.sessionFork === true,
        availableCommands: caps?.availableCommands ?? [],
        runConfigurationReady: Boolean(caps),
        configOptions: catalog?.configOptions ?? [],
        modelConfigOptions: Object.fromEntries(
          catalog?.models.map((model) => [
            model.modelId,
            configurationOptionsForModel(caps!, model.modelId),
          ]) ?? [],
        ),
        runModels:
          catalog?.models.map((model) => ({
            value: model.modelId,
            label: model.name,
            reasoningEfforts: caps?.modelReasoningEfforts?.[model.modelId] ?? [],
            planMode: false,
            fastMode: false,
          })) ?? [],
        permissionModes:
          catalog?.modes.map((mode) => ({
            value: mode.id,
            label: mode.name,

            icon: 'permission' as const,
          })) ?? [],
      });
    };
    this.unmachine = machine.subscribe(update);
    update(machine.read());
    if (target.agentConfigId && !this.state.target)
      throw new Error('Select an agent from this machine.');
  };
  refreshCapabilities = async () => {
    const target = this.state.target;
    if (!target) throw new Error('Select a machine and agent.');
    await refreshMachineCapabilities(
      this.required().runtime,
      target.machineId,
      target.agentConfigId,
      crypto.randomUUID(),
      this.lifecycle.signal,
    );
    this.active();
  };
  readConversation = async (sessionId: string) => {
    const metadata = await this.metadataFor(sessionId);
    const handle = await this.required().runtime.openSession(sessionId);
    try {
      this.active();
      const snapshot = handle.read();
      return this.conversation(metadata, mapHistory(snapshot.history), snapshot.queue);
    } finally {
      await handle.close();
    }
  };
  open = async (sessionId: string) => {
    this.selectedSessionId = sessionId;
    const connection = this.required();
    const opening = ++this.opening;
    this.unhistory?.();
    this.unhistory = undefined;
    const old = this.handle;
    this.handle = null;
    await old?.close();
    this.active();
    const handle = await connection.runtime.openSession(sessionId);
    if (this.lifecycle.signal.aborted || opening !== this.opening) {
      await handle.close();
      return;
    }
    this.handle = handle;
    const update = () => {
      if (opening !== this.opening) return;
      const snapshot = handle.read();
      const messages = mapHistory(snapshot.history);
      const pending = this.pending;
      if (pending?.sessionId === sessionId) {
        const sent = messages.find((message) => message.id === pending.input.requestId);
        if (sent) sent.contexts = pending.contexts;
      }
      this.publish({
        ...(this.state.error?.startsWith(`session_document_invalid: session-${sessionId} `)
          ? { error: null }
          : {}),
        conversations: this.state.conversations.map((row) =>
          row.id === sessionId
            ? {
                ...row,
                messages,
                queued: snapshot.queue,
                updatedAt: latestMessageTime(messages, row.updatedAt),
                title:
                  row.title === '新对话'
                    ? messages.find((message) => message.role === 'user')?.text.slice(0, 80) ||
                      row.title
                    : row.title,
              }
            : row,
        ),
      });
    };
    this.unhistory = handle.subscribe(update, this.report);
    update();
    const conversation = this.state.conversations.find((row) => row.id === sessionId);
    if (conversation) await this.selectTarget(conversation.target);
    if (this.pending?.sessionId === sessionId) await this.recoverDelivery(false);
  };
  private async restoreAdmission() {
    await navigator.locks.request(this.creationKey(), () => {
      this.active();
      this.pending = v.parse(
        v.nullable(pendingSchema),
        JSON.parse(localStorage.getItem(this.journalKey()) ?? 'null'),
      );
      this.creation = v.parse(
        v.nullable(creationSchema),
        JSON.parse(localStorage.getItem(this.creationKey()) ?? 'null'),
      );
      const firstTurn = v.parse(
        v.nullable(firstTurnSchema),
        JSON.parse(localStorage.getItem(this.firstTurnKey()) ?? 'null'),
      );
      if (
        (this.creation &&
          (this.creation.scope !== this.accountKey ||
            this.creation.metadata.userId !== this.options.accountId)) ||
        (firstTurn &&
          (firstTurn.metadata.userId !== this.options.accountId ||
            firstTurn.input.userId !== this.options.accountId ||
            (this.creation && !sameMetadata(firstTurn.metadata, this.creation.metadata)) ||
            (this.pending &&
              (firstTurn.metadata.id !== this.pending.sessionId ||
                firstTurn.input.requestId !== this.pending.input.requestId)))) ||
        (this.pending && this.pending.input.userId !== this.options.accountId)
      )
        throw new Error('Admission identity mismatch.');
      // Older versions removed the delivery journal before the first-turn record.
      // Restore that operation after an interrupted cleanup, preserving its request ID.
      if (!this.pending && firstTurn) {
        this.pending = {
          sessionId: firstTurn.metadata.id,
          input: firstTurn.input,
          contexts: mapHistory([
            {
              id: firstTurn.input.requestId,
              role: 'user',
              timestamp: firstTurn.input.timestamp,
              userId: firstTurn.input.userId,
              inputConfig: firstTurn.input.inputConfig,
            },
          ])[0]!.contexts,
        };
        localStorage.setItem(this.journalKey(), JSON.stringify(this.pending));
      }
      if (!this.pending && this.creation) {
        // A metadata-only reservation never submitted a message. Release only the
        // local reservation; cloud conversations and scoped drafts remain intact.
        localStorage.removeItem(this.creationKey());
        this.creation = null;
      }
      this.publish({
        admission: this.pending
          ? {
              sessionId: this.pending.sessionId,
              phase: 'delivery-unconfirmed',
              operationId: this.pending.input.requestId,
            }
          : null,
      });
    });
  }
  recoverDelivery = async (resume = true) =>
    navigator.locks.request(this.creationKey(), async () => {
      const runtime = this.required().runtime;
      const pending = v.parse(
        v.nullable(pendingSchema),
        JSON.parse(localStorage.getItem(this.journalKey()) ?? 'null'),
      );
      if (!pending) {
        const creation = v.parse(
          v.nullable(creationSchema),
          JSON.parse(localStorage.getItem(this.creationKey()) ?? 'null'),
        );
        this.active();
        if (!creation) {
          this.pending = null;
          this.publish({ error: null, admission: null });
          return true;
        }
        if (
          creation.scope !== this.accountKey ||
          creation.metadata.userId !== this.options.accountId
        )
          throw new Error('Admission identity mismatch.');
        const existing = (await runtime.listSessions()).find(
          (row) => row.id === creation.metadata.id,
        );
        this.active();
        if (existing && !sameMetadata(existing, creation.metadata))
          throw new Error('Admission metadata conflict.');
        try {
          if (!existing) {
            if (!resume) return false;
            await runtime.createSession(creation.metadata);
          }
          this.active();
          this.creation = creation;
          await this.list();
          this.publish({
            error: null,
            admission: { sessionId: creation.metadata.id, phase: 'awaiting-first-turn' },
          });
          return true;
        } catch (error) {
          this.report(error);
          throw error;
        }
      }
      if (pending.kind) {
        if (pending.input.userId !== this.options.accountId)
          throw new Error('Delivery identity mismatch.');
        this.pending = pending;
        if (!resume) return false;
        try {
          await this.deliverMutation(pending);
        } catch (error) {
          if (error instanceof TurnRejectedError) {
            localStorage.removeItem(this.journalKey());
            this.pending = null;
            this.publish({ admission: null });
          }
          throw error;
        }
        localStorage.removeItem(this.journalKey());
        this.pending = null;
        this.publish({ error: null, admission: null });
        return true;
      }
      const savedAdmission = v.parse(
        v.nullable(firstTurnSchema),
        JSON.parse(localStorage.getItem(this.firstTurnKey()) ?? 'null'),
      );
      if (
        savedAdmission &&
        (savedAdmission.metadata.id !== pending.sessionId ||
          savedAdmission.metadata.userId !== this.options.accountId ||
          savedAdmission.input.requestId !== pending.input.requestId)
      )
        throw new Error('Admission identity mismatch.');
      if (pending.input.userId !== this.options.accountId)
        throw new Error('Delivery identity mismatch.');
      const existingMetadata = (await runtime.listSessions()).find(
        (row) => row.id === pending.sessionId,
      );
      this.active();
      if (!existingMetadata && savedAdmission && resume) {
        try {
          await startSession(runtime, savedAdmission.metadata, savedAdmission.input);
          this.active();
        } catch (error) {
          this.report(error);
          throw error;
        }
      }
      const handle = await runtime.openSession(pending.sessionId);
      try {
        await handle.flush();
        this.active();
        const turn = handle.read().history.find((row) => row.id === pending.input.requestId);
        const metadata = (await runtime.listSessions()).find((row) => row.id === pending.sessionId);
        this.active();
        const confirmed =
          turn?.userId === pending.input.userId &&
          turn?.timestamp === pending.input.timestamp &&
          metadata?.latestUserMsgId === pending.input.requestId &&
          (!savedAdmission || Boolean(metadata && sameMetadata(metadata, savedAdmission.metadata)));
        if (!confirmed) {
          if (!resume) {
            this.publish({ error: `Request ${pending.input.requestId} remains unconfirmed.` });
            return false;
          }
          if (
            turn &&
            (turn.userId !== pending.input.userId || turn.timestamp !== pending.input.timestamp)
          )
            throw new Error('Delivery identity conflict.');
          if (savedAdmission && metadata && !sameMetadata(metadata, savedAdmission.metadata))
            throw new Error('Admission metadata conflict.');
          try {
            if (savedAdmission)
              await startSession(runtime, savedAdmission.metadata, savedAdmission.input);
            else await runtime.send(pending.sessionId, pending.input);
            this.active();
          } catch (error) {
            if (!this.lifecycle.signal.aborted && error instanceof SessionAdmissionError)
              localStorage.setItem(
                this.firstTurnKey(),
                JSON.stringify(v.parse(firstTurnSchema, error.admission)),
              );
            this.report(error);
            throw error;
          }
        }
        if (this.creation?.metadata.id === pending.sessionId) {
          localStorage.removeItem(this.creationKey());
          this.creation = null;
        }
        localStorage.removeItem(this.firstTurnKey());
        localStorage.removeItem(this.journalKey());
        this.pending = null;
        this.publish({ error: null, admission: null });
        return true;
      } finally {
        await handle.close();
      }
    });
  private metadata(
    target: ExecutionTarget,
    existing?: SessionMetadata,
    input?: SendTurn,
  ): SessionMetadata {
    if (target.project.kind === 'github' && !target.project.branch)
      throw new Error('Select an explicit GitHub branch.');
    const agent =
      input?.inputConfig ??
      this.machine?.read().agents.find((row) => row.id === target.agentConfigId);
    if (!agent) throw new Error('Selected agent configuration is unavailable.');
    return buildSessionMetadata({
      id: existing?.id ?? crypto.randomUUID(),
      machineId: target.machineId,
      agentConfigId: target.agentConfigId,
      userId: this.options.accountId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      cliType: agent.cliType,
      agentType: agent.agentType,
      ...(input ? { lastMessageAt: Date.parse(input.timestamp) } : {}),
      ...(target.project.kind === 'github'
        ? {
            project: {
              kind: 'github' as const,
              repoFullName: target.project.repo,
              branch: target.project.branch!,
            },
          }
        : target.project.kind === 'local'
          ? {
              project: {
                kind: 'local' as const,
                localProjectId: target.project.localProjectId,
                ...(target.project.branch ? { branch: target.project.branch } : {}),
              },
            }
          : {}),
    });
  }
  create = async (target: ExecutionTarget) => {
    await this.selectTarget(target);
    this.active();
    if (!this.state.target)
      throw new Error('Select a real machine and agent before creating a session.');
    const meta = this.metadata(target);
    return navigator.locks.request(this.creationKey(), async () => {
      this.active();
      const stored = v.parse(
        v.nullable(creationSchema),
        JSON.parse(localStorage.getItem(this.creationKey()) ?? 'null'),
      );
      const creation =
        stored ?? v.parse(creationSchema, { scope: this.accountKey, metadata: meta });
      if (
        creation.scope !== this.accountKey ||
        creation.metadata.userId !== this.options.accountId ||
        !sameMetadata(creation.metadata, {
          ...meta,
          id: creation.metadata.id,
          createdAt: creation.metadata.createdAt,
        })
      )
        throw new Error('Recover the existing admission before changing its target.');
      this.creation = creation;
      localStorage.setItem(this.creationKey(), JSON.stringify(creation));
      this.publish({
        admission: { sessionId: creation.metadata.id, phase: 'metadata-unconfirmed' },
        error: null,
      });
      try {
        const runtime = this.required().runtime;
        const existing = (await runtime.listSessions()).find(
          (row) => row.id === creation.metadata.id,
        );
        this.active();
        if (existing && !sameMetadata(existing, creation.metadata))
          throw new Error('Admission metadata conflict.');
        if (!existing) await runtime.createSession(creation.metadata);
        this.active();
        await this.list();
        this.publish({
          admission: { sessionId: creation.metadata.id, phase: 'awaiting-first-turn' },
        });
        return this.conversation(creation.metadata);
      } catch (error) {
        this.report(error);
        throw error;
      }
    });
  };
  private sending = false;
  send = async (input: SendInput) => {
    if (this.sending) throw new Error('A send is already in progress.');
    this.sending = true;
    try {
      await this.sendTurn(input);
    } finally {
      this.sending = false;
    }
  };
  private prepare(input: Omit<SendInput, 'sessionId'>, firstTurn = false): SendTurn {
    this.required();
    if (input.fail || input.retry)
      throw new Error('Demo failure and retry flags are not supported by the real runtime.');
    if (!input.operationId || (!input.text.trim() && !input.attachments?.length))
      throw new Error('A request ID and message are required.');
    const target = this.state.target;
    const snapshot = this.machine?.read();
    const agent = snapshot?.agents.find((row) => row.id === target?.agentConfigId);
    const caps = target ? snapshot?.capabilities[target.agentConfigId] : undefined;
    if (!target || !agent || !caps)
      throw new Error('Real agent capabilities are required before sending.');
    const config = validateRunConfiguration(input.inputConfig, caps);
    const content = contextInput(
      input.text.trim() || '请阅读附加的资料并提供帮助。',
      input.contexts,
    );
    return v.parse(turnSchema, {
      requestId: input.operationId,
      timestamp: new Date().toISOString(),
      userId: this.options.accountId,
      inputConfig: {
        ...content,
        prompt: firstTurn
          ? [agent.prompt, content.prompt].filter((part) => part?.trim()).join('\n\n')
          : content.prompt,
        inputBlocks: [...content.inputBlocks, ...(input.attachments ?? [])],
        cliType: agent.cliType,
        agentType: agent.agentType,
        ...(config.modelId ? { modelId: config.modelId } : {}),
        ...(config.modeId ? { modeId: config.modeId } : {}),
        ...(Object.keys(config.configOptionValues).length
          ? { configOptionValues: config.configOptionValues }
          : {}),
        ...(config.mcpServerIds === undefined ? {} : { mcpServerIds: config.mcpServerIds }),
      },
    });
  }
  start = async (target: ExecutionTarget, input: Omit<SendInput, 'sessionId'>) => {
    if (this.sending) throw new Error('A send is already in progress.');
    this.sending = true;
    const frozen = structuredClone(input);
    const frozenTarget = structuredClone(target);
    try {
      await this.selectTarget(frozenTarget);
      this.active();
      const catalog = this.required().mcpCatalog;
      if (frozen.inputConfig && frozen.inputConfig.mcpServerIds === undefined && catalog) {
        frozen.inputConfig.mcpServerIds = (await catalog.list())
          .filter((server) => server.enabledByDefault)
          .map((server) => server.id);
        this.active();
      }
      const turn = this.prepare(frozen, true);
      return await this.withDeliveryLock(async () => {
        this.active();
        this.checkPending(turn);
        const stored = v.parse(
          v.nullable(creationSchema),
          JSON.parse(localStorage.getItem(this.creationKey()) ?? 'null'),
        );
        const meta = this.metadata(frozenTarget, stored?.metadata, turn);
        // Upstream schema.ts deriveDraftSessionTitle; keep the shared desktop dependency out.
        const title = frozen.text
          .split('\n')
          .map((line) => line.trim())
          .find(Boolean)
          ?.slice(0, 50);
        if (title) {
          meta.title = title;
          meta.titleSource = 'draft';
        }
        if (frozen.reservedSessionId) {
          if (stored && stored.metadata.id !== frozen.reservedSessionId)
            throw new Error('Recover the existing admission before replacing its identity.');
          meta.id = frozen.reservedSessionId;
        }
        const creation =
          stored ?? v.parse(creationSchema, { scope: this.accountKey, metadata: meta });
        if (
          creation.scope !== this.accountKey ||
          !sameMetadata(creation.metadata, {
            ...meta,
            id: creation.metadata.id,
            createdAt: creation.metadata.createdAt,
          })
        )
          throw new Error('Recover the existing admission before changing its target.');
        const pending = v.parse(pendingSchema, {
          sessionId: creation.metadata.id,
          input: turn,
          contexts: frozen.contexts,
        });
        this.creation = creation;
        localStorage.setItem(this.creationKey(), JSON.stringify(creation));
        await this.deliver(pending);
        await this.list();
        return (
          this.state.conversations.find((row) => row.id === creation.metadata.id) ??
          this.conversation(creation.metadata)
        );
      });
    } finally {
      this.sending = false;
    }
  };
  private withDeliveryLock<T>(deliver: () => Promise<T>) {
    // A contending send must not queue behind a completed delivery and become a new turn.
    return navigator.locks.request(this.creationKey(), { ifAvailable: true }, (lock) => {
      this.active();
      if (!lock) throw new Error('另一个窗口正在发送，请等待完成后再继续。草稿已保留。');
      return deliver();
    });
  }
  private checkPending(turn: SendTurn) {
    const saved = v.parse(
      v.nullable(pendingSchema),
      JSON.parse(localStorage.getItem(this.journalKey()) ?? 'null'),
    );
    if (saved?.input.requestId === turn.requestId) {
      const previous = saved.input.inputConfig;
      const next = turn.inputConfig;
      const before = previous.configOptionValues ?? {};
      const after = next.configOptionValues ?? {};
      if (
        (previous.mcpServerIds === undefined) !== (next.mcpServerIds === undefined) ||
        (previous.mcpServerIds ?? []).length !== (next.mcpServerIds ?? []).length ||
        (previous.mcpServerIds ?? []).some((id, index) => id !== next.mcpServerIds?.[index]) ||
        previous.modelId !== next.modelId ||
        previous.modeId !== next.modeId ||
        previous.prompt !== next.prompt ||
        Object.keys(before).length !== Object.keys(after).length ||
        Object.entries(before).some(([id, value]) => after[id] !== value) ||
        (previous.inputBlocks ?? []).length !== (next.inputBlocks ?? []).length ||
        (previous.inputBlocks ?? []).some((block, index) => {
          const other = next.inputBlocks?.[index];
          if (!other || block.type !== other.type) return true;
          if (block.type === 'text' && other.type === 'text') return block.text !== other.text;
          if (block.type === 'image' && other.type === 'image')
            return (
              block.imageId !== other.imageId ||
              block.mimeType !== other.mimeType ||
              block.fileName !== other.fileName ||
              block.sizeBytes !== other.sizeBytes ||
              block.width !== other.width ||
              block.height !== other.height ||
              block.storageSessionId !== other.storageSessionId
            );
          if (block.type === 'file' && other.type === 'file')
            return (
              block.fileId !== other.fileId ||
              block.fileName !== other.fileName ||
              block.mimeType !== other.mimeType ||
              block.sizeBytes !== other.sizeBytes ||
              block.sha256 !== other.sha256 ||
              block.textPreview !== other.textPreview ||
              block.transport !== other.transport ||
              block.uploadedAt !== other.uploadedAt ||
              block.storageSessionId !== other.storageSessionId
            );
          return true;
        })
      )
        throw new Error('Saved request configuration is immutable. Recover its original delivery.');
    }
    if (this.state.busy || this.pending || saved)
      throw new Error('Check pending delivery before sending another request.');
  }
  private sendTurn = async (input: SendInput) => {
    const frozen = structuredClone(input);
    const conversation = this.state.conversations.find((row) => row.id === frozen.sessionId);
    if (!conversation) throw new Error('Select an available conversation.');
    await this.selectTarget(conversation.target);
    this.active();
    const history = await this.required().runtime.openSession(frozen.sessionId);
    let firstTurn: boolean;
    try {
      firstTurn = !history.read().history.some((turn) => turn.role === 'user');
    } finally {
      await history.close();
    }
    this.active();
    const turn = this.prepare(frozen, firstTurn);
    this.checkPending(turn);
    await this.open(frozen.sessionId);
    this.active();
    const pending = v.parse(pendingSchema, {
      sessionId: frozen.sessionId,
      input: turn,
      contexts: frozen.contexts,
    });
    await this.withDeliveryLock(() => this.deliver(pending));
  };
  private deliver = async (pending: Pending) => {
    const connection = this.required();
    const turn = pending.input;
    const input = { sessionId: pending.sessionId, operationId: turn.requestId };
    this.checkPending(turn);
    this.active();
    const creation = v.parse(
      v.nullable(creationSchema),
      JSON.parse(localStorage.getItem(this.creationKey()) ?? 'null'),
    );
    if (
      creation &&
      (creation.scope !== this.accountKey ||
        creation.metadata.userId !== this.options.accountId ||
        creation.metadata.id !== input.sessionId)
    )
      throw new Error('Recover the existing admission before sending to another session.');
    localStorage.setItem(this.journalKey(), JSON.stringify(pending));
    this.pending = pending;
    if (creation)
      localStorage.setItem(
        this.firstTurnKey(),
        JSON.stringify(
          v.parse(firstTurnSchema, {
            metadata: creation.metadata,
            input: turn,
            state: 'metadata-synced',
          }),
        ),
      );
    this.publish({
      busy: true,
      error: null,
      admission: {
        sessionId: input.sessionId,
        phase: 'delivery-unconfirmed',
        operationId: input.operationId,
      },
    });
    try {
      if (creation) await startSession(connection.runtime, creation.metadata, turn);
      else await connection.runtime.send(input.sessionId, turn);
      this.active();
      if (creation) {
        localStorage.removeItem(this.creationKey());
        localStorage.removeItem(this.firstTurnKey());
        this.creation = null;
      }
      localStorage.removeItem(this.journalKey());
      this.pending = null;
      this.publish({ admission: null });
    } catch (error) {
      if (!this.lifecycle.signal.aborted && error instanceof SessionAdmissionError)
        localStorage.setItem(
          this.firstTurnKey(),
          JSON.stringify(v.parse(firstTurnSchema, error.admission)),
        );
      this.report(error);
      throw error;
    } finally {
      this.publish({ busy: false });
    }
  };
  listSkills = async () => {
    const target = this.state.target;
    if (!target) throw new Error('请先选择对话助手。');
    const result = v.parse(
      skillResultSchema,
      await this.required().runtime.listSkills(
        target.machineId,
        this.options.workspaceId,
        this.options.accountId,
        crypto.randomUUID(),
        undefined,
        this.lifecycle.signal,
      ),
    );
    this.active();
    if (!result.ok) throw new Error(result.message ?? result.error);
    return result.result.groups;
  };
  private scheduleRepository() {
    const repository = this.required().schedules;
    if (!repository) throw new Error('当前连接没有定时任务协议。');
    return repository;
  }
  private async checkScheduleMachine(machineId: string) {
    const machines = await this.required().machines.listMachineInfos?.([machineId]);
    this.active();
    if (
      !this.state.machineIds.includes(machineId) ||
      (machines?.[0]?.protocolCapabilities?.schedules ?? 0) < 1
    )
      throw new Error('所选机器尚不支持定时任务，请更新 Lody。');
  }
  readonly schedules: ChatSchedules = {
    list: () => this.scheduleRepository().list(),
    read: (id) => this.scheduleRepository().read(id),
    runtimeRows: () => this.scheduleRepository().runtimeRows(),
    save: async (input) => {
      await this.checkScheduleMachine(input.draft.machineId);
      return this.scheduleRepository().save({ ...input, actorId: this.options.accountId });
    },
    setEnabled: async (input) => {
      if (input.enabled) {
        const document = await this.scheduleRepository().read(input.scheduleId);
        if (!document) throw new Error('定时任务不存在。');
        await this.checkScheduleMachine(document.definition.machineId);
      }
      return this.scheduleRepository().setEnabled({ ...input, actorId: this.options.accountId });
    },
    requestRun: async (input) => {
      const document = await this.scheduleRepository().read(input.scheduleId);
      if (!document) throw new Error('定时任务不存在。');
      await this.checkScheduleMachine(document.definition.machineId);
      return this.scheduleRepository().requestRun({ ...input, actorId: this.options.accountId });
    },
    delete: (id) => this.scheduleRepository().delete(id, this.options.accountId, Date.now()),
  };
  private async metadataFor(sessionId: string) {
    const metadata = (await this.required().runtime.listSessions()).find(
      (row) => row.id === sessionId,
    );
    this.active();
    if (!metadata) throw new Error('会话已不可用，请刷新历史。');
    return metadata;
  }
  rename = async (sessionId: string, title: string) => {
    if (!title.trim()) throw new Error('请输入会话名称。');
    await this.metadataFor(sessionId);
    await this.required().runtime.renameSession(sessionId, title);
    this.active();
    await this.list();
  };
  private async machineMutation(sessionId: string, kind: 'archive' | 'delete') {
    const metadata = await this.metadataFor(sessionId);
    const machine = await this.required().machines.open(metadata.machineId);
    try {
      this.active();
      if (kind === 'archive') await machine.archiveSession(sessionId, this.options.accountId);
      else await machine.deleteSession(sessionId);
      this.active();
      await this.list();
    } finally {
      await machine.close();
    }
  }
  archive = (sessionId: string) => this.machineMutation(sessionId, 'archive');
  delete = (sessionId: string) => this.machineMutation(sessionId, 'delete');
  restore = async (sessionId: string) => {
    const metadata = await this.metadataFor(sessionId);
    if (metadata.project?.kind === 'local') {
      const machine = await this.required().machines.open(metadata.machineId);
      try {
        const projectId = metadata.project.localProjectId;
        if (!machine.read().projects.some((project) => project.localProjectId === projectId))
          throw new Error('请先在 Lody 中重新添加此本地项目，再恢复会话。');
      } finally {
        await machine.close();
      }
    }
    await this.required().runtime.patchMetadata(sessionId, { isArchived: false });
    this.active();
    await this.list();
  };
  private async awaitForkMetadata(sessionId: string) {
    const runtime = this.required().runtime;
    const signal = AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(30_000)]);
    let cleanup = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        const aborted = () =>
          reject(
            new Error('分叉已受理，正在等待目标会话同步。请使用同一请求重试。', {
              cause: signal.reason,
            }),
          );
        const inspect = async () => {
          signal.throwIfAborted();
          const rows = await runtime.listSessions();
          if (rows.some((row) => row.id === sessionId)) resolve();
        };
        const check = () => {
          void inspect().catch(reject);
        };
        const unsubscribe = runtime.subscribeSessions(check);
        cleanup = () => {
          unsubscribe();
          signal.removeEventListener('abort', aborted);
        };
        signal.addEventListener('abort', aborted, { once: true });
        check();
      });
    } finally {
      cleanup();
    }
    this.active();
    await this.list();
  }
  fork = async (
    sessionId: string,
    turnId: string,
    operationId: string,
    targetSessionId: string,
  ) => {
    const metadata = await this.metadataFor(sessionId);
    const result = v.parse(
      v.object({
        success: v.boolean(),
        targetSessionId: v.string(),
        partial: v.boolean(),
        disposition: v.exactOptional(v.string()),
        error: v.exactOptional(v.object({ message: v.string() })),
      }),
      await this.required().runtime.fork(
        metadata.machineId,
        {
          sourceSessionId: sessionId,
          sourceTurnId: turnId,
          targetSessionId,
          requestedByUserId: this.options.accountId,
          targetContext: { kind: 'shared' },
        },
        operationId,
        this.lifecycle.signal,
      ),
    );
    this.active();
    if (!result.success || result.partial || result.disposition === 'confirmation-required')
      throw new Error(result.error?.message ?? '分叉尚未完成，请检查原会话和目标会话。');
    if (result.targetSessionId !== targetSessionId)
      throw new Error('Fork response identity mismatch.');
    await this.awaitForkMetadata(targetSessionId);
    return { sessionId: targetSessionId };
  };
  private async deliverMutation(pending: Pending) {
    const metadata = await this.metadataFor(pending.sessionId);
    if (pending.kind === 'queue') {
      await this.required().runtime.send(pending.sessionId, pending.input, 'queue');
      this.active();
      return;
    }
    if (!pending.expectedTurnId) throw new Error('Missing expected turn identity.');
    if (pending.kind === 'steer') {
      await steerTurn(
        this.required().runtime,
        metadata.machineId,
        pending.sessionId,
        pending.expectedTurnId,
        pending.input,
        this.lifecycle.signal,
      );
    } else if (pending.kind === 'edit') {
      const result = v.parse(
        v.object({
          success: v.boolean(),
          sessionId: v.string(),
          replacementUserTurnId: v.string(),
          error: v.exactOptional(v.object({ message: v.string() })),
        }),
        await this.required().runtime.editAndResend(
          metadata.machineId,
          pending.sessionId,
          pending.expectedTurnId,
          pending.input,
          this.lifecycle.signal,
        ),
      );
      if (
        result.sessionId !== pending.sessionId ||
        result.replacementUserTurnId !== pending.input.requestId
      )
        throw new Error('Edit response identity mismatch.');
      if (!result.success)
        throw new TurnRejectedError(result.error?.message ?? '修改被拒绝，请检查会话。');
    }
    this.active();
  }
  private async mutateTurn(
    input: SendInput,
    expectedTurnId: string,
    kind: 'edit' | 'steer' | 'queue',
  ) {
    if (this.sending) throw new Error('A send is already in progress.');
    this.sending = true;
    try {
      const frozen = structuredClone(input);
      const metadata = await this.metadataFor(frozen.sessionId);
      await this.selectTarget(this.conversation(metadata).target);
      const turn = this.prepare(frozen);
      await this.withDeliveryLock(async () => {
        this.checkPending(turn);
        const pending = v.parse(pendingSchema, {
          sessionId: frozen.sessionId,
          input: turn,
          contexts: frozen.contexts,
          kind,
          expectedTurnId,
        });
        localStorage.setItem(this.journalKey(), JSON.stringify(pending));
        this.pending = pending;
        this.publish({
          busy: true,
          error: null,
          admission: {
            sessionId: frozen.sessionId,
            phase: 'delivery-unconfirmed',
            operationId: turn.requestId,
          },
        });
        try {
          await this.deliverMutation(pending);
        } catch (error) {
          if (error instanceof TurnRejectedError) {
            localStorage.removeItem(this.journalKey());
            this.pending = null;
            this.publish({ admission: null });
          }
          throw error;
        }
        localStorage.removeItem(this.journalKey());
        this.pending = null;
        this.publish({ admission: null });
      });
    } catch (error) {
      this.report(error);
      throw error;
    } finally {
      this.sending = false;
      this.publish({ busy: false });
    }
  }
  edit = (input: SendInput, expectedUserTurnId: string) =>
    this.mutateTurn(input, expectedUserTurnId, 'edit');
  queue = (input: SendInput) => this.mutateTurn(input, '', 'queue');
  steer = (input: SendInput, expectedTurnId: string) =>
    this.mutateTurn(input, expectedTurnId, 'steer');
  listMcpServers = async () => {
    const catalog = this.required().mcpCatalog;
    if (!catalog) throw new Error('当前连接不支持读取 MCP 目录');
    return catalog.list();
  };
  private async shareManagement() {
    this.active();
    const access = this.options.ports?.requireAccess ?? requireApiAccess;
    await Promise.all([access(this.options.authOrigin), access(this.options.convexUrl)]);
    this.active();
    const fetch = cloudFetch();
    const jwt = new BetterAuthConvexJwtProvider({
      authOrigin: this.options.authOrigin,
      fetch,
      getSessionBearer: async () => {
        this.active();
        return this.options.token;
      },
    });
    return new ConvexShareManagement({
      origin: this.options.convexUrl,
      fetch,
      getJwt: (signal) => jwt.getJwt(AbortSignal.any([this.lifecycle.signal, signal])),
    });
  }
  private sharingConfigured() {
    this.active();
    if (!this.options.shareOrigin) throw new Error('未配置共享阅读地址');
    if (!this.options.shareApiOrigin) throw new Error('共享服务不可用，请重试。（缺少服务地址）');
  }
  readonly sharing: ChatSharing = {
    verifyCredential: async (shareId, secret) => {
      this.active();
      const origin = this.options.shareApiOrigin;
      if (!origin) throw new Error('共享服务不可用，请重试。（缺少服务地址）');
      await (this.options.ports?.requireAccess ?? requireApiAccess)(origin);
      this.active();
      await openStaticShare({ origin, shareId, secret, signal: this.lifecycle.signal });
    },
    get apiOrigin() {
      return undefined;
    },
    get publicOrigin() {
      return undefined;
    },
    list: async (pagination) =>
      (await this.shareManagement()).list(this.options.workspaceId, pagination, {
        signal: this.lifecycle.signal,
      }),
    getManagement: async (rootSessionId, shareId) =>
      (await this.shareManagement()).getManagement(
        this.options.workspaceId,
        rootSessionId,
        shareId,
        { signal: this.lifecycle.signal },
      ),
    prepare: async (input) => {
      this.sharingConfigured();
      const conversations = [];
      for (const sessionId of input.sessionIds) {
        input.signal?.throwIfAborted();
        const conversation = await this.readConversation(sessionId);
        conversations.push({
          sourceId: conversation.id,
          title: conversation.title,
          history: conversation.messages.map((message) => message.turn),
        });
      }
      input.signal?.throwIfAborted();
      return prepareSharePackage({
        rootSourceId: input.rootSessionId,
        conversations,
        capturedAt: input.capturedAt,
        ...(input.previousSourceIds ? { previousSourceIds: input.previousSourceIds } : {}),
        signal: AbortSignal.any([this.lifecycle.signal, ...(input.signal ? [input.signal] : [])]),
        fileAttachmentOmissionText: '此分享不包含文件附件',
        readAttachment: async (source, signal) => {
          const ref = v.parse(
            v.object({ imageId: v.string(), storageSessionId: v.exactOptional(v.string()) }),
            source.reference,
          );
          if (source.kind !== 'image') throw new Error('此分享不支持文件附件');
          const service = await this.attachmentService();
          const blob = await service.downloadImage(
            {
              workspaceId: this.options.workspaceId,
              sessionId: ref.storageSessionId ?? source.conversationSourceId,
              attachmentId: ref.imageId,
            },
            signal ? { signal } : {},
          );
          return { bytes: new Uint8Array(await blob.arrayBuffer()), mediaType: blob.type };
        },
      });
    },
    beginDeployment: async (input, options) => {
      this.sharingConfigured();
      return (await this.shareManagement()).beginDeployment(
        { ...input, workspaceId: this.options.workspaceId },
        {
          ...options,
          signal: AbortSignal.any([
            this.lifecycle.signal,
            ...(options?.signal ? [options.signal] : []),
          ]),
        },
      );
    },
    upload: async (input) => {
      this.sharingConfigured();
      const origin = this.options.shareApiOrigin!;
      await (this.options.ports?.requireAccess ?? requireApiAccess)(origin);
      this.active();
      await uploadPreparedShare({
        ...input,
        origin,
        signal: AbortSignal.any([this.lifecycle.signal, ...(input.signal ? [input.signal] : [])]),
      });
    },
    publishDeployment: async (deploymentId, options) => {
      this.sharingConfigured();
      return (await this.shareManagement()).publishDeployment(deploymentId, {
        ...options,
        signal: AbortSignal.any([
          this.lifecycle.signal,
          ...(options?.signal ? [options.signal] : []),
        ]),
      });
    },
    resetCredential: async (input, options) =>
      (await this.shareManagement()).resetCredential(input, {
        ...options,
        signal: AbortSignal.any([
          this.lifecycle.signal,
          ...(options?.signal ? [options.signal] : []),
        ]),
      }),
    revoke: async (input, options) =>
      (await this.shareManagement()).revoke(input, {
        ...options,
        signal: AbortSignal.any([
          this.lifecycle.signal,
          ...(options?.signal ? [options.signal] : []),
        ]),
      }),
  };
  private async attachmentService() {
    this.active();
    const origin = this.options.attachmentOrigin;
    if (!origin) throw new Error('附件服务不可用，请重试。（缺少服务地址）');
    await (this.options.ports?.requireAccess ?? requireApiAccess)(origin);
    this.active();
    return createAttachmentClient({
      origin,
      auth: {
        getToken: async () => {
          this.active();
          return this.options.token;
        },
      },
    });
  }
  uploadAttachment = async (
    storageSessionId: string,
    file: File,
    options: AttachmentRequestOptions = {},
  ): Promise<ChatAttachment> => {
    const service = await this.attachmentService();
    const location = { workspaceId: this.options.workspaceId, sessionId: storageSessionId };
    const request = {
      ...options,
      signal: AbortSignal.any([this.lifecycle.signal, ...(options.signal ? [options.signal] : [])]),
    };
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      const [image] = await service.uploadImages(
        { ...location, images: [{ blob: file, fileName: file.name }] },
        request,
      );
      this.active();
      if (!image) throw new Error('Attachment service returned no image.');
      return {
        type: 'image',
        imageId: image.imageId,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        ...(image.fileName !== undefined ? { fileName: image.fileName } : {}),
        ...(image.width !== undefined ? { width: image.width } : {}),
        ...(image.height !== undefined ? { height: image.height } : {}),
        storageSessionId,
      };
    }
    const attachment = await service.uploadFile(
      {
        ...location,
        blob: file,
        fileName: file.name,
        textPreview: file.type.startsWith('text/') || file.type === 'application/json',
      },
      request,
    );
    this.active();
    return { ...attachment, storageSessionId };
  };
  downloadAttachment = async (
    sessionId: string,
    attachment: ChatAttachment,
    options: AttachmentRequestOptions = {},
  ) => {
    const service = await this.attachmentService();
    const location = {
      workspaceId: this.options.workspaceId,
      sessionId: attachment.storageSessionId ?? sessionId,
      attachmentId: attachment.type === 'image' ? attachment.imageId : attachment.fileId,
    };
    const request = {
      ...options,
      signal: AbortSignal.any([this.lifecycle.signal, ...(options.signal ? [options.signal] : [])]),
    };
    const blob =
      attachment.type === 'image'
        ? await service.downloadImage(location, request)
        : await service.downloadFile(location, request);
    this.active();
    return blob;
  };
  stop = async (sessionId: string) => {
    const connection = this.required();
    await this.open(sessionId);
    this.active();
    const conversation = this.state.conversations.find((row) => row.id === sessionId);
    const active = conversation?.messages.findLast(
      (message) => message.role === 'agent' && message.status === 'streaming',
    );
    if (!conversation || !active) throw new Error('No active turn to stop.');
    await connection.runtime.stop(
      conversation.target.machineId,
      sessionId,
      active.id,
      crypto.randomUUID(),
      this.lifecycle.signal,
    );
    this.active();
  };
  respondPermission = async (
    sessionId: string,
    turnId: string,
    requestId: string,
    optionId: string | null,
  ) => {
    await this.required().runtime.respondPermission(
      sessionId,
      turnId,
      requestId,
      optionId === null ? { outcome: 'cancelled' } : { outcome: 'selected', optionId },
    );
    this.active();
  };
  close = async () => {
    clearTimeout(this.reconnectTimer);
    this.lifecycle.abort();
    ++this.opening;
    ++this.selecting;
    ++this.listing;
    this.unlist?.();
    this.unhistory?.();
    this.unmachine?.();
    const handle = this.handle;
    const machine = this.machine;
    const connection = this.connection;
    this.handle = null;
    this.machine = null;
    this.connection = null;
    await Promise.allSettled([
      handle?.close(),
      machine?.close(),
      connection?.close(),
      this.shortcuts.close(),
    ]);
    this.listeners.clear();
  };
}
