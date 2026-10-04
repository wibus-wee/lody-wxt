import type {
  LodyClient as SdkClient,
  SendTurn,
  SessionHandle,
  SessionMetadata,
} from '@lody-mobile/sdk';
import {
  BetterAuthConvexJwtProvider,
  ConvexCloudDirectory,
  StreamsMachineCommands,
} from '@lody-mobile/sdk';
import { createLoroSessionRuntime } from '@lody-mobile/sdk/loro';
import { JsonRpcStreams } from '@lody-mobile/sdk/rpc';
import { IndexedDBStorageAdaptor } from 'loro-repo/storage/indexeddb';
import * as v from 'valibot';

import { agentIdentity } from '../../shared/icons/agent-identity';
import { contextInput, contextSchema, mapHistory } from '../chat/real-adapter';
import { turnSchema } from '../conversations/admission';
import { createDocumentCursorStore } from '../conversations/runtime-storage';
import {
  refreshMachineCapabilities,
  SessionAdmissionError,
  startSession,
} from '../conversations/session-flows';
import { creationSchema, firstTurnSchema, sameMetadata } from './admission';
import type {
  ClientSnapshot,
  Conversation,
  ExecutionTarget,
  LodyClient,
  SendInput,
} from './client';
import { configurationOptionsForModel, validateRunConfiguration } from './run-configuration';
import { requireApiAccess } from './state';
import { cloudFetch } from './worker-fetch';

type SdkConnection = Awaited<ReturnType<typeof createLoroSessionRuntime>>;
export type RealConnection = Pick<SdkConnection, 'runtime' | 'close'> & {
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
});
type Pending = v.InferOutput<typeof pendingSchema>;
function latestMessageTime(messages: Conversation['messages'], fallback: number) {
  return messages.reduce((time, message) => Math.max(time, message.createdAt ?? 0), fallback);
}

export class RealLodyClient implements LodyClient {
  readonly mode = 'real' as const;
  readonly capabilities = { cancel: true, approvals: true, pageActions: false } as const;
  readonly accountKey: string;
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
  private directory: Pick<ConvexCloudDirectory, 'listMachines'> | null = null;
  private machine: MachineHandle | null = null;
  private handle: SessionHandle | null = null;
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
      const fetch = cloudFetch();
      const jwt = new BetterAuthConvexJwtProvider({
        authOrigin: options.authOrigin,
        fetch,
        getSessionBearer: async () => {
          this.active();
          return options.token;
        },
      });
      this.directory =
        options.ports?.directory ??
        new ConvexCloudDirectory({ convexUrl: options.convexUrl, jwt, fetch });
      let grant = await options.client.streams.getGrant(options.token, options.workspaceId, {
        signal: this.lifecycle.signal,
      });
      this.active();
      const baseUrl = grant.gatewayBaseUrl;
      if (!baseUrl) throw new Error('Streams grant did not provide a gateway URL.');
      this.publish({ gatewayOrigin: new URL(baseUrl).origin });
      await access(new URL(baseUrl).origin);
      this.active();
      let expiresAt = Date.now() + grant.expiresIn * 1000;
      let refresh: Promise<void> | null = null;
      const auth = async () => {
        this.active();
        if (Date.now() >= expiresAt - 10_000) {
          refresh ??= options.client.streams
            .getGrant(options.token, options.workspaceId, { signal: this.lifecycle.signal })
            .then((next) => {
              this.active();
              if (next.gatewayBaseUrl !== baseUrl)
                throw new Error('Streams gateway changed. Reconnect the workspace.');
              grant = next;
              expiresAt = Date.now() + next.expiresIn * 1000;
            })
            .finally(() => {
              refresh = null;
            });
          await refresh;
        }
        this.active();
        return grant.token;
      };
      const connection = await (options.ports?.createConnection ?? createLoroSessionRuntime)({
        workspaceId: options.workspaceId,
        streamsBaseUrl: baseUrl,
        auth,
        commands: new StreamsMachineCommands({
          workspaceId: options.workspaceId,
          streams: new JsonRpcStreams({ baseUrl, auth }),
        }),
        storageAdapter: new IndexedDBStorageAdaptor({
          dbName: `lody:repo:${this.accountKey}`,
          durability: 'strict',
        }),
        documentRemoteCursorStore: createDocumentCursorStore(this.accountKey),
        signal: this.lifecycle.signal,
      });
      if (this.lifecycle.signal.aborted) {
        await connection.close();
        return;
      }
      this.connection = connection;
      await this.restoreAdmission();
      this.unlist = connection.runtime.subscribeSessions(() => {
        void this.list().catch(this.report);
      });
      const machines = await this.directory.listMachines(options.workspaceId, {
        signal: this.lifecycle.signal,
      });
      this.active();
      const machineIds = machines.map((row) => row.machineId);
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
  ): Conversation {
    const project = meta.project;
    const agentId = v.safeParse(v.string(), meta.agentConfigId);
    const activity = v.safeParse(v.pipe(v.number(), v.finite()), meta.lastMessageAt);
    return {
      id: meta.id,
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
      permissionModes: [],
      configOptions: [],
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
        configOptions: caps?.configOptions ?? [],
        modelConfigOptions: Object.fromEntries(
          caps?.models.map((model) => [
            model.modelId,
            configurationOptionsForModel(caps, model.modelId),
          ]) ?? [],
        ),
        runModels:
          caps?.models.map((model) => ({
            value: model.modelId,
            label: model.name,
            reasoningEfforts: caps.modelReasoningEfforts?.[model.modelId] ?? [],
            planMode: false,
            fastMode: false,
          })) ?? [],
        permissionModes:
          caps?.modes.map((mode) => ({
            value: mode.id,
            label: mode.name,
            ...(mode.description ? { description: mode.description } : {}),
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
  open = async (sessionId: string) => {
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
  private metadata(target: ExecutionTarget, existing?: SessionMetadata): SessionMetadata {
    if (target.project.kind === 'github' && !target.project.branch)
      throw new Error('Select an explicit GitHub branch.');
    return {
      id: existing?.id ?? crypto.randomUUID(),
      machineId: target.machineId,
      agentConfigId: target.agentConfigId,
      userId: this.options.accountId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      isArchived: false,
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
    };
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
  private prepare(input: Omit<SendInput, 'sessionId'>): SendTurn {
    this.required();
    if (input.fail || input.retry)
      throw new Error('Demo failure and retry flags are not supported by the real runtime.');
    if (!input.operationId || !input.text.trim())
      throw new Error('A request ID and message are required.');
    const target = this.state.target;
    const snapshot = this.machine?.read();
    const agent = snapshot?.agents.find((row) => row.id === target?.agentConfigId);
    const caps = target ? snapshot?.capabilities[target.agentConfigId] : undefined;
    if (!target || !agent || !caps)
      throw new Error('Real agent capabilities are required before sending.');
    const config = validateRunConfiguration(input.inputConfig, caps);
    return v.parse(turnSchema, {
      requestId: input.operationId,
      timestamp: new Date().toISOString(),
      userId: this.options.accountId,
      inputConfig: {
        ...contextInput(input.text, input.contexts),
        cliType: agent.cliType,
        agentType: agent.agentType,
        modelId: config.modelId,
        ...(config.modeId ? { modeId: config.modeId } : {}),
        configOptionValues: config.configOptionValues,
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
      const turn = this.prepare(frozen);
      return await navigator.locks.request(this.creationKey(), async () => {
        this.active();
        this.checkPending(turn);
        const stored = v.parse(
          v.nullable(creationSchema),
          JSON.parse(localStorage.getItem(this.creationKey()) ?? 'null'),
        );
        const meta = this.metadata(frozenTarget, stored?.metadata);
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
        previous.modelId !== next.modelId ||
        previous.modeId !== next.modeId ||
        previous.prompt !== next.prompt ||
        Object.keys(before).length !== Object.keys(after).length ||
        Object.entries(before).some(([id, value]) => after[id] !== value) ||
        (previous.inputBlocks ?? []).length !== (next.inputBlocks ?? []).length ||
        (previous.inputBlocks ?? []).some((block, index) => {
          const other = next.inputBlocks?.[index];
          return block.type !== 'text' || other?.type !== 'text' || block.text !== other.text;
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
    const turn = this.prepare(frozen);
    this.checkPending(turn);
    await this.open(frozen.sessionId);
    this.active();
    const pending = v.parse(pendingSchema, {
      sessionId: frozen.sessionId,
      input: turn,
      contexts: frozen.contexts,
    });
    await navigator.locks.request(this.creationKey(), () => this.deliver(pending));
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
    await Promise.allSettled([handle?.close(), machine?.close(), connection?.close()]);
    this.listeners.clear();
  };
}
