import * as v from 'valibot';
import { browser } from 'wxt/browser';

import { isExtension } from '../../shared/storage';
import {
  emptyNotificationState,
  notificationKey,
  notificationPort,
  notificationStateSchema,
} from './model';
import { notificationAccount } from './scope';

export async function getNotificationState() {
  if (!isExtension()) return emptyNotificationState();
  const { scope } = await notificationAccount();
  const value = (await browser.storage.local.get(notificationKey))[notificationKey];
  const state =
    value === undefined ? emptyNotificationState(scope) : v.parse(notificationStateSchema, value);
  return state.scope === scope ? state : emptyNotificationState(scope);
}
export function watchNotificationState(listener: () => void) {
  if (!isExtension()) return () => {};
  const changed = (changes: Record<string, unknown>, area: string) => {
    if (
      area === 'local' &&
      [notificationKey, 'accountSession'].some((key) => Object.hasOwn(changes, key))
    )
      listener();
  };
  browser.storage.onChanged.addListener(changed);
  return () => browser.storage.onChanged.removeListener(changed);
}
export async function setNotificationsEnabled(enabled: boolean) {
  if (!isExtension()) throw new Error('系统通知需要在浏览器扩展中开启。');
  const account = notificationAccount();
  if (enabled && !(await browser.permissions.request({ permissions: ['notifications', 'alarms'] })))
    throw new Error('系统通知权限未授予，侧栏仍会显示会话状态。');
  const response = v.parse(
    v.object({ error: v.nullable(v.string()) }),
    await browser.runtime.sendMessage({
      type: 'notifications:enable',
      enabled,
      scope: (await account).scope,
    }),
  );
  if (response.error) throw new Error(response.error);
  return getNotificationState();
}
export async function notifySubmittedTurn(
  sessionId: string,
  turnId: string,
  expectedAccountKey: string,
): Promise<void> {
  if (!isExtension()) return;
  const { scope } = await notificationAccount();
  const response = v.parse(
    v.object({ error: v.nullable(v.string()) }),
    await browser.runtime.sendMessage({
      type: 'notifications:submitted',
      scope,
      sessionId,
      turnId,
      expectedAccountKey,
    }),
  );
  if (response.error) throw new Error(response.error);
}
/** Visible extension surfaces publish only a session ID, never prompt or response text. */
export function registerForegroundSession(sessionId: string | null) {
  if (!isExtension()) return () => {};
  let disposed = false;
  let port: ReturnType<typeof browser.runtime.connect> | null = null;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  const account = notificationAccount();
  let initialScope = '';
  const publish = () => {
    if (disposed) return;
    try {
      port?.postMessage({
        sessionId,
        scope: initialScope,
        visible: document.visibilityState === 'visible' && document.hasFocus(),
      });
    } catch {
      port = null;
    }
  };
  const connect = async () => {
    if (disposed) return;
    try {
      const initial = await account;
      if (disposed || !initial.scope || initial.scope !== (await notificationAccount()).scope)
        return;
      initialScope = initial.scope;
      port = browser.runtime.connect({ name: notificationPort });
      port.onDisconnect.addListener(() => {
        port = null;
        if (!disposed)
          reconnect = setTimeout(() => {
            void connect();
          }, 1000);
      });
      publish();
    } catch {
      if (!disposed)
        reconnect = setTimeout(() => {
          void connect();
        }, 1000);
    }
  };
  document.addEventListener('visibilitychange', publish);
  window.addEventListener('focus', publish);
  window.addEventListener('blur', publish);
  void connect();
  return () => {
    disposed = true;
    clearTimeout(reconnect);
    document.removeEventListener('visibilitychange', publish);
    window.removeEventListener('focus', publish);
    window.removeEventListener('blur', publish);
    port?.disconnect();
  };
}
export async function takeNotificationNavigation(): Promise<string | null> {
  if (!isExtension()) return null;
  const nonce = new URL(location.href).searchParams.get('notification');
  if (!nonce) return null;
  const tab = await browser.tabs.getCurrent();
  if (tab?.id === undefined) return null;
  const response = v.parse(
    v.object({ sessionId: v.nullable(v.string()) }),
    await browser.runtime.sendMessage({ type: 'notifications:navigate', nonce, tabId: tab.id }),
  );
  return response.sessionId;
}
