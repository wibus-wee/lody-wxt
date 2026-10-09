import * as v from 'valibot';
import { browser } from 'wxt/browser';

import type { UpdateState } from './appcast';
import {
  checkIntervalMs,
  compareVersions,
  emptyUpdateState,
  fetchAppcast,
  updateAlarm,
  updateKey,
  updateStateSchema,
} from './appcast';

const requestSchema = v.variant('type', [
  v.strictObject({ type: v.literal('updates:get') }),
  v.strictObject({ type: v.literal('updates:check') }),
  v.strictObject({ type: v.literal('updates:skip'), version: v.nullable(v.string()) }),
]);

export function registerUpdateLifecycle() {
  let active: Promise<UpdateState> | null = null;
  const load = async () => {
    const raw = (await browser.storage.local.get(updateKey))[updateKey];
    return raw === undefined ? { ...emptyUpdateState } : v.parse(updateStateSchema, raw);
  };
  const save = async (state: UpdateState) => {
    await browser.storage.local.set({ [updateKey]: state });
    return state;
  };
  function check(force = false): Promise<UpdateState> {
    if (active) return force ? active.then(() => check(true)) : active;
    active = (async () => {
      const previous = await load();
      if (
        !force &&
        previous.lastAttemptAt > 0 &&
        Date.now() - previous.lastAttemptAt < checkIntervalMs
      )
        return previous;
      const attempt = { ...previous, lastAttemptAt: Date.now() };
      await save(attempt);
      try {
        const release = await fetchAppcast();
        if (previous.release && compareVersions(release.version, previous.release.version) < 0)
          throw new Error('更新源版本低于上次确认的版本，未替换已确认的更新信息。');
        return await save({
          ...attempt,
          release,
          checkedAt: Date.now(),
          error: null,
          skippedVersion:
            force || previous.release?.version !== release.version ? null : previous.skippedVersion,
        });
      } catch (error) {
        return save({
          ...attempt,
          error: error instanceof Error ? error.message : '无法检查更新。',
        });
      }
    })().finally(() => {
      active = null;
    });
    return active;
  }
  const schedule = async () => {
    if (!(await browser.alarms.get(updateAlarm)))
      await browser.alarms.create(updateAlarm, { periodInMinutes: 360 });
    await check();
  };
  const wake = () => {
    void schedule().catch((error: unknown) => console.error('Update lifecycle failed.', error));
  };
  browser.runtime.onInstalled.addListener(wake);
  browser.runtime.onStartup.addListener(wake);
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === updateAlarm) wake();
  });
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    const parsed = v.safeParse(requestSchema, message);
    if (!parsed.success) return undefined;
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('')))
      return Promise.resolve({ ok: false, error: '不允许从网页操作扩展更新。' });
    const request = parsed.output;
    return (async () => {
      if (request.type === 'updates:skip') {
        if (active) await active;
        const state = await load();
        if (!new Set([null, state.release?.version]).has(request.version))
          throw new Error('可用版本已变化，请刷新后重新选择。');
        return save({ ...state, skippedVersion: request.version });
      }
      return check(request.type === 'updates:check');
    })().then(
      (state) => ({ ok: true, state }),
      (error: unknown) => ({
        ok: false,
        error: error instanceof Error ? error.message : '无法读取更新状态。',
      }),
    );
  });
  wake();
}
