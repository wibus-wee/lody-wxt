import type { SessionHandle } from '@lody-mobile/sdk';
import * as v from 'valibot';
import type { Browser } from 'wxt/browser';
import { browser } from 'wxt/browser';

import { productConfig } from '../../app/product-config';
import type { RemoteMachine, WorkspaceMethods, WorkspaceReply } from './background-protocol';
import {
  parseWorkspaceArgs,
  workspaceIdentitySchema,
  workspacePort,
  workspaceRequestSchema,
} from './background-protocol';
import type { BackgroundWorkspace } from './background-workspace';
import { BackgroundWorkspaceOwner } from './background-workspace';
import { clearCachedBootstrap } from './workspace-bootstrap-cache';

const alarm = 'lody:workspace:sync';
const commandMethods = new Set([
  'session/cancel',
  'session/steer',
  'machine/acp-capabilities-refresh',
  'session/fork',
  'session/edit-and-resend',
  'local-project/control',
]);
// Rejections cross both the SDK and browser API boundaries with arbitrary thrown values.
// ast-grep-ignore: no-unknown-parameter
function errorDetail(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) };
}

function serve(port: Browser.runtime.Port, owner: BackgroundWorkspaceOwner) {
  let closed = false;
  let workspace: BackgroundWorkspace | undefined;
  let authorizing = false;
  const opening = new Map<string, AbortController>();
  const lifecycle = new AbortController();
  const sessions = new Map<string, { handle: SessionHandle; unsubscribe: () => void }>();
  const machines = new Map<string, { handle: RemoteMachine; unsubscribe: () => void }>();
  const requests = new Map<string, AbortController>();
  const unsubscribers: (() => void)[] = [];
  const send = (message: WorkspaceReply) => {
    if (!closed) port.postMessage(message);
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    lifecycle.abort();
    for (const controller of requests.values()) controller.abort();
    for (const unsubscribe of unsubscribers) unsubscribe();
    for (const entry of [...sessions.values(), ...machines.values()]) {
      entry.unsubscribe();
      void entry.handle.close().catch(() => {});
    }
    sessions.clear();
    machines.clear();
  };
  const required = () => {
    lifecycle.signal.throwIfAborted();
    if (!workspace) throw new Error('Workspace port is not authorized.');
    workspace.signal.throwIfAborted();
    if (workspace.session.expiresAtMs <= Date.now())
      throw new Error('Workspace authorization expired.');
    return workspace;
  };
  const session = (id: string) => {
    required();
    const entry = sessions.get(id);
    if (!entry) throw new Error('Session lease is closed.');
    return entry.handle;
  };
  const machine = (id: string) => {
    required();
    const entry = machines.get(id);
    if (!entry) throw new Error('Machine lease is closed.');
    return entry.handle;
  };
  const release = async (entries: typeof sessions | typeof machines, id: string) => {
    opening.get(id)?.abort();
    const entry = entries.get(id);
    entries.delete(id);
    if (entry) {
      entry.unsubscribe();
      await entry.handle.close();
    }
  };
  const handlers = (requestSignal: AbortSignal): WorkspaceMethods => ({
    async bootstrap(raw) {
      if (workspace || authorizing) throw new Error('Workspace port is already authorized.');
      authorizing = true;
      const identity = v.parse(workspaceIdentitySchema, raw);
      const ready = await owner.ensure();
      requestSignal.throwIfAborted();
      lifecycle.signal.throwIfAborted();
      if (
        !ready ||
        identity.accountId !== ready.accountId ||
        identity.accountKey !== ready.accountKey ||
        identity.workspaceId !== ready.session.workspaceId ||
        identity.authOrigin !== ready.session.config.authOrigin ||
        identity.token !== ready.session.token.access_token ||
        identity.convexUrl !== productConfig.convexOrigin
      )
        throw new Error('Workspace identity changed. Reconnect with the current account.');
      ready.signal.throwIfAborted();
      workspace = ready;
      unsubscribers.push(
        ready.connection.runtime.subscribeSessions(() => send({ type: 'sessions-changed' })),
        ready.connection.machines.subscribeMachineInfos(() => send({ type: 'machines-changed' })),
        owner.subscribeReset(() => {
          send({
            type: 'fatal',
            error: { name: 'Error', message: 'Workspace connection changed. Reconnecting.' },
          });
          cleanup();
          port.disconnect();
        }),
      );
      return { gatewayOrigin: ready.gatewayOrigin, machineIds: ready.machineIds };
    },
    'repository.create': (metadata) => required().connection.runtime.createSession(metadata),
    'repository.list': () => required().connection.runtime.listSessions(),
    'repository.patch': (id, patch) => required().connection.runtime.patchMetadata(id, patch),
    'repository.open': async function (id, leaseId) {
      if (sessions.has(leaseId) || opening.has(leaseId))
        throw new Error('Duplicate session lease.');
      const operation = new AbortController();
      opening.set(leaseId, operation);
      let handle: SessionHandle | undefined;
      let unsubscribe: (() => void) | undefined;
      try {
        const ready = required();
        handle = await ready.connection.runtime.openSession(id);
        AbortSignal.any([
          requestSignal,
          operation.signal,
          lifecycle.signal,
          ready.signal,
        ]).throwIfAborted();
        const snapshot = handle.read();
        unsubscribe = handle.subscribe(
          (snapshot) => send({ type: 'session', leaseId, snapshot }),
          (error) => send({ type: 'session-error', leaseId, error: errorDetail(error) }),
        );
        sessions.set(leaseId, { handle, unsubscribe });
        return snapshot;
      } catch (error) {
        unsubscribe?.();
        await handle?.close();
        throw error;
      } finally {
        opening.delete(leaseId);
      }
    },
    'session.append': (id, ...args) => session(id).append(...args),
    'session.respondPermission': (id, ...args) => session(id).respondPermission(...args),
    'session.promote': (id, ...args) => session(id).promote(...args),
    'session.flush': async function (id) {
      const handle = session(id);
      await handle.flush();
      return handle.read();
    },
    'session.close': (id) => release(sessions, id),
    'machines.list': (ids) => required().connection.machines.listMachineInfos(ids),
    'machines.open': async function (id, leaseId) {
      if (machines.has(leaseId) || opening.has(leaseId))
        throw new Error('Duplicate machine lease.');
      const operation = new AbortController();
      opening.set(leaseId, operation);
      let handle: RemoteMachine | undefined;
      let unsubscribe: (() => void) | undefined;
      try {
        const ready = required();
        if (!ready.machineIds.includes(id))
          throw new Error('Machine is not visible in this workspace.');
        handle = await ready.connection.machines.open(id);
        AbortSignal.any([
          requestSignal,
          operation.signal,
          lifecycle.signal,
          ready.signal,
        ]).throwIfAborted();
        const snapshot = handle.read();
        unsubscribe = handle.subscribe((snapshot) => send({ type: 'machine', leaseId, snapshot }));
        machines.set(leaseId, { handle, unsubscribe });
        return snapshot;
      } catch (error) {
        unsubscribe?.();
        await handle?.close();
        throw error;
      } finally {
        opening.delete(leaseId);
      }
    },
    'machine.archive': (id, ...args) => machine(id).archiveSession(...args),
    'machine.delete': (id, ...args) => machine(id).deleteSession(...args),
    'machine.close': (id) => release(machines, id),
    'schedules.list': () => required().connection.schedules.list(),
    'schedules.runtimeRows': () => required().connection.schedules.runtimeRows(),
    'schedules.read': (...args) => required().connection.schedules.read(...args),
    'schedules.save': (...args) => required().connection.schedules.save(...args),
    'schedules.setEnabled': (...args) => required().connection.schedules.setEnabled(...args),
    'schedules.requestRun': (...args) => required().connection.schedules.requestRun(...args),
    'schedules.delete': (...args) => required().connection.schedules.delete(...args),
    'mcp.list': () => required().connection.mcpCatalog.list(),
    'commands.request': () => {
      throw new Error('Command cancellation context is required.');
    },
  });
  port.onMessage.addListener((raw: unknown) => {
    const parsed = v.safeParse(workspaceRequestSchema, raw);
    if (!parsed.success) {
      send({ type: 'fatal', error: { name: 'Error', message: 'Invalid workspace request.' } });
      cleanup();
      port.disconnect();
      return;
    }
    const request = parsed.output;
    if (request.type === 'cancel') {
      requests.get(request.id)?.abort();
      return;
    }
    if (requests.has(request.id)) {
      send({
        type: 'error',
        id: request.id,
        error: { name: 'Error', message: 'Duplicate workspace request.' },
      });
      return;
    }
    const controller = new AbortController();
    requests.set(request.id, controller);
    void (async () => {
      try {
        const args = parseWorkspaceArgs(request.method, request.args);
        let value: unknown;
        if (request.method === 'commands.request') {
          const [machineId, method, params, requestId] = v.parse(
            v.tuple([v.string(), v.string(), v.record(v.string(), v.unknown()), v.string()]),
            args,
          );
          const ready = required();
          if (!ready.machineIds.includes(machineId) || !commandMethods.has(method))
            throw new Error('Unsupported workspace command.');
          value = await ready.commands.request(
            machineId,
            method,
            params,
            requestId,
            AbortSignal.any([controller.signal, lifecycle.signal, ready.signal]),
          );
        } else {
          value = await Reflect.apply(handlers(controller.signal)[request.method], undefined, args);
        }
        if (!controller.signal.aborted)
          send({ type: 'result', id: request.id, value: value ?? null });
      } catch (error) {
        if (!controller.signal.aborted)
          send({ type: 'error', id: request.id, error: errorDetail(error) });
      } finally {
        requests.delete(request.id);
      }
    })();
  });
  port.onDisconnect.addListener(cleanup);
}

export function registerWorkspaceConnectionLifecycle() {
  const owner = new BackgroundWorkspaceOwner();
  const refresh = () => {
    void owner
      .ensure()
      .catch((error: unknown) =>
        console.warn('Workspace background connection failed', errorDetail(error)),
      );
  };
  const wake = () => {
    void browser.alarms.create(alarm, { periodInMinutes: 1 });
    refresh();
  };
  browser.runtime.onStartup.addListener(wake);
  browser.runtime.onInstalled.addListener(wake);
  browser.alarms.onAlarm.addListener((event) => {
    if (event.name === alarm) refresh();
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.accountSession || changes.accountConfig)) {
      owner.reset();
      void clearCachedBootstrap();
      refresh();
    }
  });
  browser.permissions.onRemoved.addListener((permissions) => {
    if (permissions.origins?.length) {
      void owner
        .revalidateAccess()
        .catch((error: unknown) =>
          console.warn('Workspace permission changed', errorDetail(error)),
        );
    }
  });
  browser.permissions.onAdded.addListener((permissions) => {
    if (permissions.origins?.length) refresh();
  });
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== workspacePort) return;
    if (
      port.sender?.id !== browser.runtime.id ||
      !port.sender.url?.startsWith(browser.runtime.getURL(''))
    ) {
      port.disconnect();
      return;
    }
    serve(port, owner);
  });
  wake();
}
