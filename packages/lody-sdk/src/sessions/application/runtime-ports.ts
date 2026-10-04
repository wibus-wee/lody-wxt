import type { SendTurn, SessionMetadata, SessionSnapshot } from '../domain/runtime.js';

export interface SessionHandle {
  read: () => SessionSnapshot;
  /** Invalid snapshots go to onError when provided; later valid snapshots still notify the listener. */
  subscribe: (
    listener: (snapshot: SessionSnapshot) => void,
    onError?: (error: Error) => void,
  ) => () => void;
  append: (input: SendTurn, kind: 'dispatch' | 'queue' | 'guide') => Promise<void>;
  respondPermission: (
    turnId: string,
    requestId: string,
    outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string },
  ) => Promise<void>;
  promote: (turnId: string) => Promise<void>;
  flush: () => Promise<void>;
  close: () => Promise<void>;
}

export interface SessionRepository {
  create: (meta: SessionMetadata) => Promise<void>;
  list: () => Promise<SessionMetadata[]>;
  subscribe: (listener: () => void) => () => void;
  open: (sessionId: string) => Promise<SessionHandle>;
  patch: (sessionId: string, patch: Partial<SessionMetadata>) => Promise<void>;
  close: () => Promise<void>;
}

export interface MachineCommandPort {
  request: (
    machineId: string,
    method: string,
    params: Record<string, unknown>,
    requestId: string,
    signal?: AbortSignal,
  ) => Promise<unknown>;
}
