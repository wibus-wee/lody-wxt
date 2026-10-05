import type {
  MachineCommandPort,
  SessionHandle,
  SessionRepository,
  SessionSnapshot,
} from '@lody-mobile/sdk';
import { SessionRuntime } from '@lody-mobile/sdk';
import * as v from 'valibot';
import { browser } from 'wxt/browser';

import type {
  MachineSnapshot,
  RemoteMachine,
  WorkspaceBootstrap,
  WorkspaceIdentity,
  WorkspaceMethods,
} from './background-protocol';
import { workspacePort, workspaceReplySchema } from './background-protocol';
import type { RealConnection } from './real-client';

interface SessionLease {
  snapshot: SessionSnapshot | null;
  listeners: Set<(snapshot: SessionSnapshot) => void>;
  errors: Set<(error: Error) => void>;
  error: Error | null;
}
interface MachineLease {
  snapshot: MachineSnapshot | null;
  listeners: Set<(snapshot: MachineSnapshot) => void>;
}
interface Pending {
  // The typed caller decodes the SDK result transported by its matching RPC response.
  // ast-grep-ignore: no-unknown-parameter
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}
function remoteError(value: { name: string; message: string }) {
  const error = new Error(value.message);
  error.name = value.name;
  return error;
}
function transportFailure(value: unknown) {
  const parsed = v.safeParse(v.instance(Error), value);
  return parsed.success
    ? parsed.output
    : new Error('Workspace transport failed.', { cause: value });
}

export async function connectBackgroundWorkspace(
  identity: WorkspaceIdentity,
  signal: AbortSignal,
  onDisconnect: (error: Error) => void,
): Promise<WorkspaceBootstrap & { connection: RealConnection }> {
  signal.throwIfAborted();
  const port = browser.runtime.connect({ name: workspacePort });
  const pending = new Map<string, Pending>();
  const sessions = new Map<string, SessionLease>();
  const machines = new Map<string, MachineLease>();
  const sessionListeners = new Set<() => void>();
  const machineListeners = new Set<() => void>();
  let closed = false;
  let disconnectError: Error | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  function finish(error: Error, notify: boolean) {
    if (closed) return;
    closed = true;
    disconnectError = error;
    signal.removeEventListener('abort', aborted);
    clearTimeout(refreshTimer);
    for (const operation of pending.values()) {
      operation.cleanup();
      operation.reject(error);
    }
    pending.clear();
    sessions.clear();
    machines.clear();
    sessionListeners.clear();
    machineListeners.clear();
    port.disconnect();
    if (notify) onDisconnect(error);
  }
  function aborted() {
    finish(new Error('Workspace connection closed'), false);
  }
  signal.addEventListener('abort', aborted, { once: true });
  port.onDisconnect.addListener(() => {
    finish(new Error('工作区后台连接已断开，请重新连接。'), true);
  });
  port.onMessage.addListener((value: unknown) => {
    const parsed = v.safeParse(workspaceReplySchema, value);
    if (!parsed.success) {
      finish(new Error('Workspace background returned an invalid response.'), true);
      return;
    }
    const message = parsed.output;
    switch (message.type) {
      case 'result':
      case 'error': {
        const operation = pending.get(message.id);
        if (!operation) return;
        pending.delete(message.id);
        operation.cleanup();
        if (message.type === 'error') operation.reject(remoteError(message.error));
        else operation.resolve(message.value);
        return;
      }
    }
    if (message.type === 'fatal') {
      finish(remoteError(message.error), true);
    } else if (message.type === 'sessions-changed') {
      for (const listener of sessionListeners) listener();
    } else if (message.type === 'machines-changed') {
      for (const listener of machineListeners) listener();
    } else if (message.type === 'session') {
      const lease = sessions.get(message.leaseId);
      if (!lease) return;
      // The trusted background owns SDK decoding; the port only transports its JSON snapshots.
      lease.snapshot = message.snapshot as SessionSnapshot;
      lease.error = null;
      for (const listener of lease.listeners) listener(lease.snapshot);
    } else if (message.type === 'session-error') {
      const lease = sessions.get(message.leaseId);
      if (!lease) return;
      lease.error = remoteError(message.error);
      for (const listener of lease.errors) listener(lease.error);
    } else {
      const lease = machines.get(message.leaseId);
      if (!lease) return;
      lease.snapshot = message.snapshot as MachineSnapshot;
      for (const listener of lease.listeners) listener(lease.snapshot);
    }
  });

  function call<K extends keyof WorkspaceMethods>(
    method: K,
    args: Parameters<WorkspaceMethods[K]>,
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<WorkspaceMethods[K]>>> {
    if (closed) return Promise.reject(disconnectError ?? new Error('Workspace connection closed'));
    signal?.throwIfAborted();
    const id = crypto.randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const cancel = () => {
        const operation = pending.get(id);
        if (!operation) return;
        pending.delete(id);
        operation.cleanup();
        port.postMessage({ type: 'cancel', id });
        reject(new DOMException('Workspace request cancelled', 'AbortError'));
      };
      const timer = setTimeout(() => {
        const operation = pending.get(id);
        if (!operation) return;
        pending.delete(id);
        operation.cleanup();
        port.postMessage({ type: 'cancel', id });
        reject(new Error('Workspace background request timed out.'));
      }, 60_000);
      pending.set(id, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
        },
      });
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        port.postMessage({ type: 'call', id, method, args });
      } catch (error) {
        finish(transportFailure(error), true);
      }
    });
    // Request and response types share one method map; SDK validation happens in the background.
    return result as Promise<Awaited<ReturnType<WorkspaceMethods[K]>>>;
  }

  const repository: SessionRepository = {
    create: (meta) => call('repository.create', [meta]),
    list: () => call('repository.list', []),
    patch: (sessionId, patch) => call('repository.patch', [sessionId, patch]),
    subscribe: (listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    open: async (sessionId) => {
      const leaseId = crypto.randomUUID();
      const lease: SessionLease = {
        snapshot: null,
        listeners: new Set(),
        errors: new Set(),
        error: null,
      };
      sessions.set(leaseId, lease);
      try {
        const initial = await call('repository.open', [sessionId, leaseId]);
        lease.snapshot ??= initial;
      } catch (error) {
        sessions.delete(leaseId);
        await call('session.close', [leaseId]).catch(() => {});
        throw error;
      }
      const active = () => {
        if (closed || !sessions.has(leaseId))
          throw disconnectError ?? new Error('Session handle closed');
      };
      const invoke = <K extends 'session.append' | 'session.respondPermission' | 'session.promote'>(
        method: K,
        args: Parameters<WorkspaceMethods[K]>,
      ) => {
        active();
        return call(method, args);
      };
      const handle: SessionHandle = {
        read: () => {
          active();
          if (lease.error) throw lease.error;
          if (!lease.snapshot) throw new Error('Session snapshot is unavailable');
          return lease.snapshot;
        },
        subscribe: (listener, onError) => {
          active();
          lease.listeners.add(listener);
          if (onError) lease.errors.add(onError);
          if (lease.error) onError?.(lease.error);
          return () => {
            lease.listeners.delete(listener);
            if (onError) lease.errors.delete(onError);
          };
        },
        append: (...args) => invoke('session.append', [leaseId, ...args]),
        respondPermission: (...args) => invoke('session.respondPermission', [leaseId, ...args]),
        promote: (...args) => invoke('session.promote', [leaseId, ...args]),
        flush: async () => {
          active();
          lease.snapshot = await call('session.flush', [leaseId]);
          lease.error = null;
        },
        close: async () => {
          if (!sessions.delete(leaseId) || closed) return;
          await call('session.close', [leaseId]);
        },
      };
      return handle;
    },
    close: async () => {
      finish(new Error('Workspace connection closed'), false);
    },
  };
  const commands: MachineCommandPort = {
    request: (machineId, method, params, requestId, signal) =>
      call('commands.request', [machineId, method, params, requestId], signal),
  };
  const connection: RealConnection = {
    runtime: new SessionRuntime(repository, commands),
    close: repository.close,
    machines: {
      listMachineInfos: (ids) => call('machines.list', [ids]),
      subscribeMachineInfos: (listener) => {
        machineListeners.add(listener);
        return () => machineListeners.delete(listener);
      },
      open: async (machineId) => {
        const leaseId = crypto.randomUUID();
        const lease: MachineLease = { snapshot: null, listeners: new Set() };
        machines.set(leaseId, lease);
        try {
          const initial = await call('machines.open', [machineId, leaseId]);
          lease.snapshot ??= initial;
        } catch (error) {
          machines.delete(leaseId);
          await call('machine.close', [leaseId]).catch(() => {});
          throw error;
        }
        const active = () => {
          if (closed || !machines.has(leaseId))
            throw disconnectError ?? new Error('Machine handle closed');
        };
        const handle: RemoteMachine = {
          read: () => {
            active();
            if (!lease.snapshot) throw new Error('Machine snapshot is unavailable');
            return lease.snapshot;
          },
          subscribe: (listener) => {
            active();
            lease.listeners.add(listener);
            return () => lease.listeners.delete(listener);
          },
          archiveSession: (...args) => {
            active();
            return call('machine.archive', [leaseId, ...args]);
          },
          deleteSession: (...args) => {
            active();
            return call('machine.delete', [leaseId, ...args]);
          },
          close: async () => {
            if (!machines.delete(leaseId) || closed) return;
            await call('machine.close', [leaseId]);
          },
        };
        return handle;
      },
    },
    schedules: {
      list: () => call('schedules.list', []),
      read: (...args) => call('schedules.read', args),
      runtimeRows: () => call('schedules.runtimeRows', []),
      save: (...args) => call('schedules.save', args),
      setEnabled: (...args) => call('schedules.setEnabled', args),
      requestRun: (...args) => call('schedules.requestRun', args),
      delete: (...args) => call('schedules.delete', args),
    },
    mcpCatalog: { list: () => call('mcp.list', []) },
  };
  function scheduleRefresh() {
    if (closed) return;
    refreshTimer = setTimeout(() => {
      void call('repository.list', [])
        .then(scheduleRefresh)
        .catch((error: unknown) => {
          finish(transportFailure(error), true);
        });
    }, 20_000);
  }
  try {
    const bootstrap = await call('bootstrap', [identity], signal);
    scheduleRefresh();
    return { ...bootstrap, connection };
  } catch (error) {
    finish(transportFailure(error), false);
    throw error;
  }
}
