import { expect, it } from 'vitest';

import type { BrowserPermissionPort } from '../../src/features/privacy/browser-permissions';
import {
  readBrowserAccess,
  revokeBrowserAccess,
} from '../../src/features/privacy/browser-permissions';
import {
  deletePersonalMemory,
  personalMemoryPrompt,
  readPersonalMemory,
  savePersonalMemory,
  subscribePersonalMemory,
} from '../../src/features/privacy/memory';

it('personal memory is opt-in, scoped, observable and revision-checked', async () => {
  const scope = crypto.randomUUID();
  const other = crypto.randomUUID();
  let changes = 0;
  const stop = subscribePersonalMemory(scope, () => {
    changes++;
  });
  try {
    const original = readPersonalMemory(scope);
    expect(personalMemoryPrompt(scope)).toBeNull();
    const saved = await savePersonalMemory(scope, {
      ...original,
      text: '使用中文',
      enabled: false,
    });
    expect(personalMemoryPrompt(scope)).toBeNull();
    await expect(savePersonalMemory(scope, { ...original, text: 'stale update' })).rejects.toThrow(
      '另一个窗口',
    );
    await savePersonalMemory(scope, { ...saved, enabled: true });
    expect(personalMemoryPrompt(scope)).toBe('使用中文');
    expect(personalMemoryPrompt(other)).toBeNull();
    await deletePersonalMemory(scope);
    expect(personalMemoryPrompt(scope)).toBeNull();
    expect(changes).toBe(3);
  } finally {
    stop();
    localStorage.removeItem(`lody:personal-memory:${scope}`);
  }
});
it('malformed personal memory remains visible and retained instead of silently reset', () => {
  const scope = crypto.randomUUID();
  const key = `lody:personal-memory:${scope}`;
  localStorage.setItem(key, JSON.stringify({ enabled: true, text: 'unknown version' }));
  try {
    expect(() => readPersonalMemory(scope)).toThrow('无法读取');
    expect(localStorage.getItem(key)).toContain('unknown version');
  } finally {
    localStorage.removeItem(key);
  }
});
it('permission controls protect required hosts and verify browser revocation', async () => {
  let origins = ['https://api.lody.ai/*', 'https://example.com/*'];
  let permissions = ['storage', 'history'];
  const removed: unknown[] = [];
  const port: BrowserPermissionPort = {
    available: true,
    required: () => ({ host_permissions: ['https://api.lody.ai/*'], permissions: ['storage'] }),
    getAll: async () => ({ origins, permissions }),
    remove: async (input) => {
      removed.push(input);
      origins = origins.filter((origin) => !input.origins?.includes(origin));
      permissions = permissions.filter((permission) => !input.permissions?.includes(permission));
      return true;
    },
    openShortcuts: async () => {},
  };
  expect((await readBrowserAccess(port))?.origins[0]?.required).toBe(true);
  await expect(revokeBrowserAccess('origin', 'https://api.lody.ai/*', port)).rejects.toThrow(
    '必需',
  );
  expect(removed).toHaveLength(0);
  await revokeBrowserAccess('origin', 'https://example.com/*', port);
  await revokeBrowserAccess('permission', 'history', port);
  expect(origins).toEqual(['https://api.lody.ai/*']);
  expect(permissions).toEqual(['storage']);
  const stale: BrowserPermissionPort = {
    ...port,
    getAll: async () => ({ permissions: ['history'] }),
    remove: async () => true,
  };
  await expect(revokeBrowserAccess('permission', 'history', stale)).rejects.toThrow('仍然有效');
});
