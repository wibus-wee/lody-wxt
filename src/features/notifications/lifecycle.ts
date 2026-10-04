import { createLodyClient } from '@lody-mobile/sdk';
import * as v from 'valibot';
import type { Browser } from 'wxt/browser';
import { browser } from 'wxt/browser';

import { requireApiAccess } from '../connection/state';
import type { NotificationEvent, NotificationState } from './model';
import {
  emptyNotificationState,
  foregroundSchema,
  navigationKey,
  navigationSchema,
  notificationAlarm,
  notificationKey,
  notificationMessage,
  notificationPort,
  notificationStateSchema,
} from './model';
import {
  changedObservation,
  connectNotificationObserver,
  observeMetadata,
  pendingPermissionIds,
  terminalEvent,
} from './observe';
import { notificationAccount } from './scope';

const prefix = 'lody-session:';
const permissions: ('notifications' | 'alarms')[] = ['notifications', 'alarms'];
const requestSchema = v.variant('type', [
  v.object({ type: v.literal('notifications:enable'), enabled: v.boolean(), scope: v.string() }),
  v.object({
    type: v.literal('notifications:submitted'),
    scope: v.string(),
    sessionId: v.string(),
    turnId: v.string(),
    expectedAccountKey: v.string(),
  }),
  v.object({ type: v.literal('notifications:navigate'), nonce: v.string(), tabId: v.number() }),
]);

export function registerNotificationLifecycle() {
  let lease: AbortController | null = null;
  let jobs = Promise.resolve();
  let identityGeneration = 0;
  const ports = new Set<Browser.runtime.Port>();
  const foreground = new Map<
    Browser.runtime.Port,
    { scope: string; sessionId: string | null; visible: boolean }
  >();
  function enqueue(work: () => Promise<void>) {
    const next = jobs.then(work);
    jobs = next.catch((error: unknown) => console.error('Notification observer failed.', error));
    return next;
  }
  async function load(): Promise<NotificationState> {
    const { scope } = await notificationAccount();
    const raw = (await browser.storage.local.get(notificationKey))[notificationKey];
    const state =
      raw === undefined ? emptyNotificationState(scope) : v.parse(notificationStateSchema, raw);
    return state.scope === scope ? state : emptyNotificationState(scope);
  }
  async function save(state: NotificationState) {
    if ((await notificationAccount()).scope !== state.scope) return;
    await browser.storage.local.set({ [notificationKey]: state });
  }
  async function clearDelivered() {
    if (!(await browser.permissions.contains({ permissions: ['notifications'] }))) return;
    const all = await browser.notifications.getAll();
    await Promise.all(
      Object.keys(all)
        .filter((id) => id.startsWith(prefix))
        .map((id) => browser.notifications.clear(id)),
    );
  }
  async function schedule() {
    const state = await load();
    if (!state.enabled || !(await browser.permissions.contains({ permissions }))) {
      await browser.alarms?.clear(notificationAlarm);
      return;
    }
    await browser.alarms.create(notificationAlarm, { delayInMinutes: 1, periodInMinutes: 1 });
  }
  async function emit(state: NotificationState, event: NotificationEvent, signal: AbortSignal) {
    if (state.events.some((stored) => stored.id === event.id)) return;
    const terminal = new Set(['completed', 'failed']).has(event.kind) && event.sessionId;
    if (terminal && state.terminal[terminal] === event.id) return;
    signal.throwIfAborted();
    if ((await notificationAccount()).scope !== state.scope) return;
    const visible = [...foreground.values()].some(
      (surface) =>
        surface.scope === state.scope && surface.visible && surface.sessionId === event.sessionId,
    );
    // Persist before displaying. A terminated worker may miss one popup, but cannot replay it.
    state.events = [...state.events, event].slice(-200);
    if (terminal) state.terminal[terminal] = event.id;
    await save(state);
    signal.throwIfAborted();
    if (!visible && (await browser.permissions.contains({ permissions: ['notifications'] }))) {
      signal.throwIfAborted();
      await browser.notifications.create(`${prefix}${event.id}`, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('/notification-icon.png'),
        title: 'Lody',
        message: notificationMessage(event.kind),
      });
    }
  }
  async function poll() {
    const state = await load();
    if (!state.enabled || !(await browser.permissions.contains({ permissions }))) return;
    if (state.failures && Date.now() - state.checkedAt < Math.min(15, 2 ** state.failures) * 60_000)
      return;
    const account = await notificationAccount();
    if (!account.session || account.scope !== state.scope) return;
    const controller = new AbortController();
    lease = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    state.checkedAt = Date.now();
    try {
      if (account.session.expiresAtMs <= Date.now()) {
        state.error = '登录已过期，请重新登录以继续接收通知。';
        await emit(
          state,
          {
            id: `login:${account.session.expiresAtMs}`,
            sessionId: null,
            kind: 'login',
            at: Date.now(),
          },
          signal,
        );
        state.enabled = false;
        await save(state);
        await browser.alarms.clear(notificationAlarm);
        return;
      }
      if (!Object.keys(state.tracked).length) return;
      const connection = await connectNotificationObserver(account.session, state, signal);
      try {
        const rows = await connection.runtime.listSessions();
        let reads = 0;
        const candidates = rows
          .filter((row) => !row.isArchived && state.tracked[row.id] !== undefined)
          .sort((left, right) => (state.tracked[right.id] ?? 0) - (state.tracked[left.id] ?? 0));
        const cursor = candidates.length ? state.readCursor % candidates.length : 0;
        const ordered = [...candidates.slice(cursor), ...candidates.slice(0, cursor)];
        state.readCursor = candidates.length ? (cursor + 5) % candidates.length : 0;
        for (const row of ordered) {
          signal.throwIfAborted();
          const next = observeMetadata(row);
          const previous = state.observed[row.id];
          if (
            state.pendingTurns[row.id] !== undefined ||
            (previous &&
              (changedObservation(previous, next) || next.status === 'requestPermission'))
          ) {
            if (new Set(['idle', 'requestPermission']).has(next.status)) {
              if (reads >= 5) continue;
              reads++;
              const handle = await connection.runtime.openSession(row.id);
              try {
                const snapshot = handle.read();
                if (next.status === 'requestPermission') {
                  const ids = pendingPermissionIds(
                    snapshot,
                    state.pendingTurns[row.id] ?? next.userTurn,
                  );
                  if (!ids.length) continue;
                  for (const requestId of ids)
                    await emit(
                      state,
                      {
                        id: `${row.id}:permission:${requestId}`,
                        sessionId: row.id,
                        kind: 'permission',
                        at: Date.now(),
                      },
                      signal,
                    );
                } else {
                  const event = terminalEvent(
                    snapshot,
                    state.pendingTurns[row.id] ?? next.userTurn,
                  );
                  if (!event) continue;
                  await emit(
                    state,
                    {
                      id: `${row.id}:${event.kind}:${event.turnId}`,
                      sessionId: row.id,
                      kind: event.kind,
                      at: Date.now(),
                    },
                    signal,
                  );
                  delete state.pendingTurns[row.id];
                }
              } finally {
                await handle.close();
              }
            }
          }
          state.observed[row.id] = next;
        }
        state.error = null;
        state.failures = 0;
      } finally {
        await connection.close();
      }
      signal.throwIfAborted();
      await save(state);
    } catch (error) {
      if (controller.signal.aborted) return;
      state.error = error instanceof Error ? error.message : '无法读取通知状态。';
      state.failures++;
      await save(state);
    } finally {
      if (lease === controller) lease = null;
    }
  }
  const alarmTriggered = (alarm: Browser.alarms.Alarm) => {
    if (alarm.name === notificationAlarm) void enqueue(poll);
  };
  function registerGrantedApis() {
    if (browser.alarms && !browser.alarms.onAlarm.hasListener(alarmTriggered)) {
      browser.alarms.onAlarm.addListener(alarmTriggered);
    }
    if (browser.notifications && !browser.notifications.onClicked.hasListener(clicked)) {
      browser.notifications.onClicked.addListener(clicked);
    }
  }
  registerGrantedApis();
  browser.permissions.onAdded.addListener(registerGrantedApis);
  browser.runtime.onStartup.addListener(() => {
    void enqueue(schedule);
  });
  browser.runtime.onInstalled.addListener(() => {
    void enqueue(schedule);
  });
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    const parsed = v.safeParse(requestSchema, message);
    if (!parsed.success) return undefined;
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('')))
      return Promise.resolve({ error: '不允许从网页修改通知设置。' });
    const request = parsed.output;
    if (request.type === 'notifications:navigate') {
      let sessionId: string | null = null;
      return enqueue(async () => {
        const targets = v.parse(
          v.record(v.string(), navigationSchema),
          (await browser.storage.session.get(navigationKey))[navigationKey] ?? {},
        );
        const target = Object.hasOwn(targets, request.nonce) ? targets[request.nonce] : undefined;
        if (!target || target.tabId !== request.tabId || target.expiresAt <= Date.now()) return;
        const expectedUrl = `${browser.runtime.getURL('/sidepanel.html')}?notification=${encodeURIComponent(request.nonce)}`;
        const senderUrl = new URL(sender.url!);
        senderUrl.hash = '';
        const tabUrl = new URL((await browser.tabs.get(request.tabId)).url ?? 'about:blank');
        tabUrl.hash = '';
        if (senderUrl.href !== expectedUrl || tabUrl.href !== expectedUrl) return;
        if (target.scope !== (await notificationAccount()).scope) return;
        delete targets[request.nonce];
        await browser.storage.session.set({ [navigationKey]: targets });
        sessionId = target.sessionId;
      }).then(() => ({ sessionId }));
    }
    if (request.type === 'notifications:enable' && !request.enabled) lease?.abort();
    return enqueue(async () => {
      registerGrantedApis();
      const state = await load();
      if (request.scope !== state.scope)
        throw new Error('账户已变化，请在当前账户重新操作通知设置。');
      if (request.type === 'notifications:submitted') {
        if (!state.enabled) return;
        const [workspaceScope] = v.parse(
          v.tuple([v.string(), v.string()]),
          JSON.parse(request.expectedAccountKey),
        );
        const [origin, clientId, accountId, workspaceId] = v.parse(
          v.tuple([v.string(), v.string(), v.string(), v.string()]),
          JSON.parse(workspaceScope),
        );
        const account = await notificationAccount();
        if (
          !account.session ||
          account.scope !== request.scope ||
          new URL(account.session.config.authOrigin).origin !== origin ||
          account.session.config.clientId !== clientId ||
          account.session.workspaceId !== workspaceId
        )
          throw new Error('已确认发送的账户与当前账户不一致，未登记通知。');
        await requireApiAccess(origin);
        const generation = identityGeneration;
        const verified = await createLodyClient({
          ...account.session.config,
          requestTimeoutMs: 10_000,
        }).identity.getAccount(account.session.token.access_token, {
          signal: AbortSignal.timeout(10_000),
        });
        if (
          verified.user.id !== accountId ||
          generation !== identityGeneration ||
          (await notificationAccount()).scope !== request.scope
        )
          throw new Error('已确认发送的账户与当前账户不一致，未登记通知。');
        state.pendingTurns[request.sessionId] = request.turnId;
        state.tracked[request.sessionId] = Date.now();
        await save(state);
        return;
      }
      if (request.enabled && (!state.scope || !(await notificationAccount()).session?.workspaceId))
        throw new Error('请先登录并选择工作区。');
      if (request.enabled && !(await browser.permissions.contains({ permissions })))
        throw new Error('系统通知权限未授予。');
      state.enabled = request.enabled;
      state.error = null;
      state.failures = 0;
      await save(state);
      await schedule();
      if (!state.enabled) await clearDelivered();
    }).then(
      () => {
        void enqueue(poll);
        return { error: null };
      },
      (error: unknown) => ({
        error: error instanceof Error ? error.message : '无法修改通知设置。',
      }),
    );
  });
  browser.runtime.onConnect.addListener((port) => {
    if (
      port.name !== notificationPort ||
      port.sender?.id !== browser.runtime.id ||
      !port.sender.url?.startsWith(browser.runtime.getURL(''))
    )
      return;
    const generation = identityGeneration;
    ports.add(port);
    const account = notificationAccount();
    let connected = true;
    port.onMessage.addListener((message: unknown) => {
      const value = v.safeParse(foregroundSchema, message);
      if (!value.success) return;
      const current = foreground.get(port);
      if (current && generation === identityGeneration && value.output.scope === current.scope)
        foreground.set(port, value.output);
      void enqueue(async () => {
        const initial = await account;
        const state = await load();
        if (
          !connected ||
          generation !== identityGeneration ||
          value.output.scope !== initial.scope ||
          state.scope !== initial.scope
        )
          return;
        foreground.set(port, value.output);
        if (!value.output.sessionId) return;
        state.tracked[value.output.sessionId] = Date.now();
        state.tracked = Object.fromEntries(
          Object.entries(state.tracked)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20),
        );
        state.observed = Object.fromEntries(
          Object.entries(state.observed).filter(([id]) => state.tracked[id] !== undefined),
        );
        state.terminal = Object.fromEntries(
          Object.entries(state.terminal).filter(([id]) => state.tracked[id] !== undefined),
        );
        state.pendingTurns = Object.fromEntries(
          Object.entries(state.pendingTurns).filter(([id]) => state.tracked[id] !== undefined),
        );
        await save(state);
      });
    });
    port.onDisconnect.addListener(() => {
      connected = false;
      ports.delete(port);
      foreground.delete(port);
    });
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.hasOwn(changes, 'accountSession')) return;
    lease?.abort();
    identityGeneration++;
    for (const port of ports) port.disconnect();
    ports.clear();
    foreground.clear();
    void enqueue(async () => {
      await browser.alarms?.clear(notificationAlarm);
      await clearDelivered();
      await browser.storage.session.remove(navigationKey);
      await save(emptyNotificationState((await notificationAccount()).scope));
    });
  });
  browser.permissions.onRemoved.addListener((removed) => {
    if (!removed.permissions?.some((permission) => new Set<string>(permissions).has(permission)))
      return;
    lease?.abort();
    void enqueue(async () => {
      const state = await load();
      state.enabled = false;
      state.error = '系统通知权限已关闭，侧栏仍会显示会话状态。';
      await save(state);
      await browser.alarms?.clear(notificationAlarm);
    });
  });
  function clicked(id: string) {
    if (!id.startsWith(prefix)) return;
    void enqueue(async () => {
      const state = await load();
      const event = state.events.find((event) => `${prefix}${event.id}` === id);
      if (!event || (!state.enabled && event.kind !== 'login')) return;
      const nonce = crypto.randomUUID();
      const tab = await browser.tabs.create({
        url: event.sessionId
          ? `${browser.runtime.getURL('/sidepanel.html')}?notification=${nonce}`
          : browser.runtime.getURL('/options.html'),
      });
      if (event.sessionId && tab.id !== undefined) {
        const old = v.parse(
          v.record(v.string(), navigationSchema),
          (await browser.storage.session.get(navigationKey))[navigationKey] ?? {},
        );
        const targets = Object.fromEntries(
          Object.entries(old)
            .filter(([, target]) => target.scope === state.scope && target.expiresAt > Date.now())
            .slice(-19),
        );
        targets[nonce] = {
          scope: state.scope,
          sessionId: event.sessionId,
          expiresAt: Date.now() + 60_000,
          tabId: tab.id,
        };
        await browser.storage.session.set({ [navigationKey]: targets });
      }
      await browser.notifications.clear(id);
    });
  }
}
