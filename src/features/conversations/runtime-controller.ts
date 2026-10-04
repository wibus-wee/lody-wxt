import type {
  SendTurn,
  SessionHandle,
  SessionMetadata,
  SessionRuntime,
  SessionSnapshot,
} from '@lody-mobile/sdk';

import { steerTurn } from './session-flows';
import type { TurnJournal } from './turn-journal';

export interface ConversationRuntimeConnection {
  runtime: SessionRuntime;
  close: () => Promise<void>;
  machines?: {
    open: (machineId: string) => Promise<{
      deleteSession: (sessionId: string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  };
}
export interface RuntimeState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  sessions: SessionMetadata[];
  snapshot: SessionSnapshot | null;
  busy: boolean;
  error: string | null;
}

export class ConversationRuntimeController {
  private state: RuntimeState = {
    status: 'disconnected',
    sessions: [],
    snapshot: null,
    busy: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private connection: ConversationRuntimeConnection | null = null;
  private handle: SessionHandle | null = null;
  private unsubscribeList: (() => void) | null = null;
  private unsubscribeHistory: (() => void) | null = null;
  private generation = 0;
  private opening = 0;
  private listing = 0;
  private command: AbortController | null = null;
  private pendingTurn: {
    sessionId: string;
    input: SendTurn;
    kind: 'dispatch' | 'queue' | 'guide';
    expectedTurnId: string;
  } | null = null;

  constructor(private readonly journal?: TurnJournal) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(state: RuntimeState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  connect = async (open: () => Promise<ConversationRuntimeConnection>) => {
    const closing = this.disconnect();
    const generation = this.generation;
    await closing;
    if (generation !== this.generation) return;
    this.publish({ ...this.state, status: 'connecting' });
    try {
      const connection = await open();
      if (generation !== this.generation) {
        await connection.close();
        return;
      }
      this.connection = connection;
      this.unsubscribeList = connection.runtime.subscribeSessions(() => {
        void this.refresh();
      });
      this.publish({ ...this.state, status: 'connected' });
      await this.refresh();
      if (generation !== this.generation) return;
      this.pendingTurn = this.journal?.load() ?? null;
      if (this.pendingTurn) {
        this.publish({
          ...this.state,
          error: `Turn ${this.pendingTurn.input.requestId} needs delivery confirmation.`,
        });
        await this.open(this.pendingTurn.sessionId);
      }
    } catch {
      if (generation === this.generation)
        this.publish({
          ...this.state,
          status: 'error',
          error: 'Workspace could not be connected.',
        });
    }
  };

  refresh = async () => {
    const connection = this.connection;
    if (!connection) return;
    const generation = this.generation;
    const listing = ++this.listing;
    try {
      const sessions = await connection.runtime.listSessions();
      if (generation === this.generation && listing === this.listing)
        this.publish({ ...this.state, sessions });
    } catch {
      if (generation === this.generation)
        this.publish({ ...this.state, error: 'Conversations could not be loaded.' });
    }
  };

  open = async (sessionId: string) => {
    const connection = this.connection;
    if (!connection) return;
    const generation = this.generation;
    const opening = ++this.opening;
    this.unsubscribeHistory?.();
    this.unsubscribeHistory = null;
    const previous = this.handle;
    this.handle = null;
    this.publish({ ...this.state, snapshot: null, busy: true, error: null });
    try {
      await previous?.close();
      const handle = await connection.runtime.openSession(sessionId);
      if (generation !== this.generation || opening !== this.opening) {
        await handle.close();
        return;
      }
      this.handle = handle;
      this.unsubscribeHistory = handle.subscribe((snapshot) => {
        if (generation === this.generation && opening === this.opening)
          this.publish({ ...this.state, snapshot });
      });
      const snapshot = handle.read();
      const pending = this.pendingTurn;
      const found =
        pending &&
        pending.sessionId === sessionId &&
        snapshot.history.find((turn) => turn.id === pending.input.requestId);
      if (
        found &&
        pending &&
        found.userId === pending.input.userId &&
        found.timestamp === pending.input.timestamp
      ) {
        await handle.flush();
        const metadata = (await connection.runtime.listSessions()).find(
          (row) => row.id === sessionId,
        );
        if (generation !== this.generation || opening !== this.opening) return;
        const confirmed =
          pending.kind === 'dispatch'
            ? metadata?.latestUserMsgId === pending.input.requestId
            : new Set(['handled', 'processing', 'seen']).has(found.status ?? '');
        if (confirmed) {
          await this.journal?.clear(pending.input.requestId);
          this.pendingTurn = null;
        }
      }
      this.publish({
        ...this.state,
        snapshot,
        busy: false,
        error: this.pendingTurn ? 'Delivery remains unconfirmed. No request was resent.' : null,
      });
    } catch {
      if (generation === this.generation && opening === this.opening)
        this.publish({ ...this.state, busy: false, error: 'Conversation could not be opened.' });
    }
  };

  patch = async (sessionId: string, patch: Partial<SessionMetadata>) => {
    const connection = this.connection;
    if (!connection || this.state.busy) return;
    const generation = this.generation;
    this.publish({ ...this.state, busy: true, error: null });
    try {
      await connection.runtime.patchMetadata(sessionId, patch);
      if (generation === this.generation) await this.refresh();
    } catch {
      if (generation === this.generation)
        this.publish({ ...this.state, error: 'Conversation changes could not be saved.' });
    } finally {
      if (generation === this.generation) this.publish({ ...this.state, busy: false });
    }
  };

  send = async (input: SendTurn, kind: 'dispatch' | 'queue' | 'guide', expectedTurnId = '') => {
    const connection = this.connection;
    const snapshot = this.state.snapshot;
    const metadata = this.state.sessions.find((session) => session.id === snapshot?.sessionId);
    if (!connection || !snapshot || !metadata || this.state.busy || this.pendingTurn) return;
    const generation = this.generation;
    this.pendingTurn = { sessionId: snapshot.sessionId, input, kind, expectedTurnId };
    const command = new AbortController();
    this.command = command;
    this.publish({ ...this.state, busy: true, error: null });
    try {
      if (this.journal && !(await this.journal.claim(this.pendingTurn))) {
        this.pendingTurn = this.journal.load();
        throw new Error('A turn is already awaiting confirmation.');
      }
      if (generation !== this.generation || command.signal.aborted) return;
      if (kind === 'guide')
        await steerTurn(
          connection.runtime,
          metadata.machineId,
          snapshot.sessionId,
          expectedTurnId,
          input,
          command.signal,
        );
      else await connection.runtime.send(snapshot.sessionId, input, kind);
      if (generation === this.generation) {
        await this.journal?.clear(input.requestId);
        if (generation !== this.generation) return;
        this.pendingTurn = null;
      }
    } catch {
      if (generation === this.generation)
        this.publish({
          ...this.state,
          error: `Turn ${input.requestId} delivery is unconfirmed. Reopen the conversation to inspect history before continuing.`,
        });
    } finally {
      if (generation === this.generation) this.publish({ ...this.state, busy: false });
    }
  };

  stop = async (turnId: string) => {
    const connection = this.connection;
    const snapshot = this.state.snapshot;
    const metadata = this.state.sessions.find((session) => session.id === snapshot?.sessionId);
    if (!connection || !snapshot || !metadata || this.state.busy) return;
    const generation = this.generation;
    const command = new AbortController();
    this.command = command;
    this.publish({ ...this.state, busy: true, error: null });
    try {
      await connection.runtime.stop(
        metadata.machineId,
        snapshot.sessionId,
        turnId,
        crypto.randomUUID(),
        command.signal,
      );
    } catch {
      if (generation === this.generation)
        this.publish({
          ...this.state,
          error: 'Stop was not confirmed. Check the conversation status.',
        });
    } finally {
      if (generation === this.generation) this.publish({ ...this.state, busy: false });
    }
  };

  respondPermission = async (turnId: string, requestId: string, optionId: string | null) => {
    const connection = this.connection;
    const sessionId = this.state.snapshot?.sessionId;
    if (!connection || !sessionId || this.state.busy) return;
    const generation = this.generation;
    this.publish({ ...this.state, busy: true, error: null });
    try {
      await connection.runtime.respondPermission(
        sessionId,
        turnId,
        requestId,
        optionId === null ? { outcome: 'cancelled' } : { outcome: 'selected', optionId },
      );
    } catch {
      if (generation === this.generation)
        this.publish({ ...this.state, error: 'Permission response was not confirmed.' });
    } finally {
      if (generation === this.generation) this.publish({ ...this.state, busy: false });
    }
  };

  deleteSession = async (sessionId: string) => {
    const connection = this.connection;
    const metadata = this.state.sessions.find((session) => session.id === sessionId);
    if (!connection?.machines || !metadata || this.state.busy) return;
    const generation = this.generation;
    this.publish({ ...this.state, busy: true, error: null });
    try {
      const machine = await connection.machines.open(metadata.machineId);
      try {
        if (generation !== this.generation) return;
        await machine.deleteSession(sessionId);
      } finally {
        await machine.close();
      }
      if (generation === this.generation) await this.refresh();
    } catch {
      if (generation === this.generation)
        this.publish({ ...this.state, error: 'Deletion was not confirmed.' });
    } finally {
      if (generation === this.generation) this.publish({ ...this.state, busy: false });
    }
  };

  forkTurn = async (turnId: string, userId: string) => {
    const connection = this.connection;
    const snapshot = this.state.snapshot;
    const metadata = this.state.sessions.find((row) => row.id === snapshot?.sessionId);
    const turn = snapshot?.history.find((row) => row.id === turnId);
    if (
      !connection ||
      !snapshot ||
      !metadata ||
      this.state.busy ||
      turn?.role !== 'assistant' ||
      turn.finished !== true
    )
      return;
    const generation = this.generation;
    const command = new AbortController();
    this.command = command;
    const targetSessionId = crypto.randomUUID();
    this.publish({ ...this.state, busy: true, error: null });
    try {
      await connection.runtime.fork(
        metadata.machineId,
        {
          sourceSessionId: snapshot.sessionId,
          sourceTurnId: turnId,
          targetSessionId,
          requestedByUserId: userId,
          targetContext: { kind: 'shared' },
        },
        crypto.randomUUID(),
        command.signal,
      );
      if (generation !== this.generation) return;
      await this.refresh();
      await this.open(targetSessionId);
    } catch {
      if (generation === this.generation)
        this.publish({
          ...this.state,
          error: `Fork was not confirmed. Target session: ${targetSessionId}. Check the list before retrying.`,
        });
    } finally {
      if (generation === this.generation) this.publish({ ...this.state, busy: false });
    }
  };

  editTurn = async (turnId: string, input: SendTurn) => {
    const connection = this.connection;
    const snapshot = this.state.snapshot;
    const metadata = this.state.sessions.find((row) => row.id === snapshot?.sessionId);
    const turn = snapshot?.history.find((row) => row.id === turnId);
    if (
      !connection ||
      !snapshot ||
      !metadata ||
      this.state.busy ||
      turn?.role !== 'user' ||
      turn.userId !== input.userId
    )
      return;
    const generation = this.generation;
    const command = new AbortController();
    this.command = command;
    this.publish({ ...this.state, busy: true, error: null });
    try {
      await connection.runtime.editAndResend(
        metadata.machineId,
        snapshot.sessionId,
        turnId,
        input,
        command.signal,
      );
      if (generation !== this.generation) return;
      await this.open(snapshot.sessionId);
    } catch {
      if (generation === this.generation)
        this.publish({
          ...this.state,
          error: `Edit was not confirmed. Replacement turn: ${input.requestId}. Check history before retrying.`,
        });
    } finally {
      if (generation === this.generation) this.publish({ ...this.state, busy: false });
    }
  };

  disconnect = async () => {
    ++this.generation;
    ++this.opening;
    ++this.listing;
    this.command?.abort();
    this.unsubscribeList?.();
    this.unsubscribeHistory?.();
    this.unsubscribeList = null;
    this.unsubscribeHistory = null;
    const handle = this.handle;
    const connection = this.connection;
    this.handle = null;
    this.connection = null;
    this.pendingTurn = null;
    this.publish({
      status: 'disconnected',
      sessions: [],
      snapshot: null,
      busy: false,
      error: null,
    });
    await handle?.close();
    await connection?.close();
  };
}
