import type { PromptShortcut, ShortcutRuntimeSnapshot } from '@lody-mobile/sdk';
import { createLodyClient, projectShortcutIndex } from '@lody-mobile/sdk';
import { expect, it, vi } from 'vitest';

import type { ShortcutClient } from '../../src/features/automations/prompt-shortcut-source';
import {
  loadPromptShortcutMentions,
  preparePromptShortcut,
} from '../../src/features/automations/prompt-shortcut-source';
import { SyncedShortcuts } from '../../src/features/automations/shortcut-client';
import {
  migrateWorkflows,
  migrationStatus,
} from '../../src/features/automations/shortcut-migration';
import { loadWorkflows, saveWorkflow } from '../../src/features/automations/storage';
import { createComposerMentionSource } from '../../src/features/chat/mentions/source';
import type { ChatShortcuts, LodyClient } from '../../src/features/connection/client';
import { RealLodyClient } from '../../src/features/connection/real-client';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const value: PromptShortcut = {
  v: 1,
  id: 'shortcut',
  workspaceId: 'workspace',
  ownerUserId: 'user',
  visibility: 'private',
  name: 'Review',
  slug: 'review',
  prompt: 'Review these changes',
  mentions: [],
  scope: {},
  revision: 'one',
  createdAt: 1,
  updatedAt: 1,
};
function shortcutsFixture() {
  const state: ShortcutRuntimeSnapshot = {
    entries: [],
    pendingIds: [],
    errors: {},
    loading: false,
  };
  const save = vi.fn<ChatShortcuts['save']>(async (input) => {
    const entry = projectShortcutIndex(input.value, input.bodyDocId);
    state.entries = [entry];
    state.pendingIds = [entry.id];
    return entry;
  });
  const retry = vi.fn<ChatShortcuts['retry']>(async () => {});
  const shortcuts: ChatShortcuts = {
    getSnapshot: () => state,
    subscribe: () => () => {},
    connect: async () => {},
    retry,
    read: async () => value,
    save,
    remove: async () => {
      state.entries = [];
      state.pendingIds = [];
    },
  };
  return { shortcuts, state, save, retry };
}
function sourceFixture() {
  const fixture = shortcutsFixture();
  const entry = projectShortcutIndex(value, 'body');
  fixture.state.entries = [entry];
  const context: ReturnType<LodyClient['shortcutContext']> = {
    workspaceId: 'workspace',
    userId: 'user',
    scope: {
      project: { kind: 'local', id: 'project-a', machineId: 'machine' },
      machineId: 'machine',
      providerKey: 'codex',
    },
  };
  const client: ShortcutClient = {
    shortcuts: fixture.shortcuts,
    shortcutContext: () => context,
    listSkills: async () => [],
  };
  return { ...fixture, entry, context, client };
}

function composerClient() {
  return new RealLodyClient({
    accountKey: crypto.randomUUID(),
    accountId: 'user',
    workspaceId: 'workspace',
    authOrigin: 'https://auth.example.test',
    convexUrl: 'https://convex.example.test',
    token: 'test-session',
    client: createLodyClient({ authOrigin: 'https://auth.example.test', clientId: 'test' }),
    ports: { requireAccess: async () => {} },
  });
}

it('fences an in-place project change while loading a shortcut body', async () => {
  const fixture = sourceFixture();
  const body = deferred<PromptShortcut>();
  fixture.shortcuts.read = () => body.promise;
  const pending = preparePromptShortcut(
    fixture.client,
    fixture.entry,
    new AbortController().signal,
  );
  fixture.context.scope.project = { kind: 'local', id: 'project-b', machineId: 'machine' };
  body.resolve(value);
  await expect(pending).rejects.toThrow('对话范围已变化');
});

it('fences shortcut catalogue loading across connection identity changes', async () => {
  const fixture = sourceFixture();
  const connected = deferred<void>();
  fixture.shortcuts.connect = () => connected.promise;
  const pending = loadPromptShortcutMentions(fixture.client, new AbortController().signal);
  fixture.context.scope.project = { kind: 'github', repository: 'org/repo' };
  connected.resolve(undefined);
  await expect(pending).rejects.toThrow('对话范围已变化');
});

it('keeps plain shortcuts usable when another publication failed and skill discovery is offline', async () => {
  const fixture = sourceFixture();
  const skillBody: PromptShortcut = {
    ...value,
    id: 'with-skill',
    slug: 'with-skill',
    prompt: '$review',
    scope: { machineId: 'machine', providerKey: 'codex' },
    mentions: [
      {
        start: 0,
        end: 7,
        label: '$review',
        target: {
          kind: 'skill',
          source: 'global',
          path: '/skills/review',
          machineId: 'machine',
          compatibleProviders: ['codex'],
        },
      },
    ],
  };
  fixture.state.entries = [...fixture.state.entries, projectShortcutIndex(skillBody, 'skill-body')];
  fixture.state.errors = { unrelated: new Error('Publication offline') };
  const skills = vi
    .fn<ShortcutClient['listSkills']>()
    .mockRejectedValue(new Error('Machine offline'));
  fixture.client.listSkills = skills;
  fixture.shortcuts.read = async (entry) => (entry.id === value.id ? value : skillBody);
  const items = await loadPromptShortcutMentions(fixture.client, new AbortController().signal);
  expect(items).toHaveLength(2);
  expect(skills).not.toHaveBeenCalled();
  expect(await items[0]!.prepare(new AbortController().signal)).toEqual({
    text: value.prompt,
    ranges: [],
  });
  await expect(items[1]!.prepare(new AbortController().signal)).rejects.toThrow('Machine offline');
  expect(fixture.state.errors.unrelated).toBeInstanceOf(Error);
});

it('reports failed discovery when no usable index has been read', async () => {
  const fixture = sourceFixture();
  fixture.state.entries = [];
  fixture.state.errors = { directory: new Error('Directory offline') };
  await expect(
    loadPromptShortcutMentions(fixture.client, new AbortController().signal),
  ).rejects.toThrow('快捷指令同步失败');
});

it('refreshes an open composer catalogue when directory recovery leaves the same entries', async () => {
  const client = composerClient();
  const fixture = shortcutsFixture();
  fixture.state.errors = { directory: new Error('Directory offline') };
  let state = fixture.state;
  const callbacks = new Set<() => void>();
  const snapshot = vi.spyOn(client.shortcuts, 'getSnapshot').mockImplementation(() => state);
  const subscription = vi.spyOn(client.shortcuts, 'subscribe').mockImplementation((callback) => {
    callbacks.add(callback);
    return () => {
      callbacks.delete(callback);
    };
  });
  const source = createComposerMentionSource({ client, sessionId: '', target: null });
  const update = vi.fn();
  const stop = source.subscribe!(update);
  try {
    state = { ...state, errors: {} };
    for (const callback of callbacks) callback();
    expect(update).toHaveBeenCalledTimes(1);
    state = { ...state, loading: true };
    for (const callback of callbacks) callback();
    expect(update).toHaveBeenCalledTimes(2);
    stop();
    expect(callbacks.size).toBe(0);
  } finally {
    stop();
    snapshot.mockRestore();
    subscription.mockRestore();
    await client.close();
  }
});

it('prefers project skills with relative references and retains absolute global/system references', async () => {
  const client = composerClient();
  const skill = (name: string, scope: 'system' | 'global') => ({
    id: `${scope}:${name}`,
    name,
    relativePath: `${name}/SKILL.md`,
    absolutePath: `/${scope}/${name}/SKILL.md`,
    isSymlink: false,
  });
  const listSkills = vi.spyOn(client, 'listSkills').mockResolvedValue([
    {
      scope: 'system',
      dir: '/system',
      truncated: false,
      skills: [skill('review', 'system'), skill('system-only', 'system')],
    },
    {
      scope: 'global',
      dir: '/global',
      truncated: false,
      skills: [skill('review', 'global'), skill('global-only', 'global')],
    },
    {
      scope: 'project',
      dir: '.agents/skills',
      truncated: false,
      skills: [
        {
          id: 'project-review',
          name: 'review',
          relativePath: '.agents/skills/review/SKILL.md',
          isSymlink: false,
        },
      ],
    },
  ]);
  try {
    const source = createComposerMentionSource({ client, sessionId: '', target: null });
    const items = await source.load('skill', new AbortController().signal);
    expect(items.map((item) => item.label)).toEqual(['$review', '$global-only', '$system-only']);
    expect(items[0]!.disabledReason).toBeUndefined();
    expect(await items[0]!.prepare(new AbortController().signal)).toEqual({
      text: '$review',
      expansion: 'use /review [Skill Path](.agents/skills/review/SKILL.md)',
    });
    expect((await items[1]!.prepare(new AbortController().signal)).expansion).toBe(
      'use /global-only [Skill Path](/global/global-only/SKILL.md)',
    );
    expect((await items[2]!.prepare(new AbortController().signal)).expansion).toBe(
      'use /system-only [Skill Path](/system/system-only/SKILL.md)',
    );
  } finally {
    listSkills.mockRestore();
    await client.close();
  }
});

it('rejects an updated shortcut while its selected skill is being verified', async () => {
  const fixture = sourceFixture();
  const skills = deferred<Awaited<ReturnType<LodyClient['listSkills']>>>();
  const body: PromptShortcut = {
    ...value,
    prompt: '$review',
    scope: { machineId: 'machine', providerKey: 'codex' },
    mentions: [
      {
        start: 0,
        end: 7,
        label: '$review',
        target: {
          kind: 'skill',
          source: 'global',
          path: '/skills/review',
          machineId: 'machine',
          compatibleProviders: ['codex'],
        },
      },
    ],
  };
  const entry = projectShortcutIndex(body, 'body');
  fixture.state.entries = [entry];
  fixture.shortcuts.read = async () => body;
  const listSkills = vi.fn(() => skills.promise);
  fixture.client.listSkills = listSkills;
  const loading = preparePromptShortcut(fixture.client, entry, new AbortController().signal);
  await vi.waitFor(() => expect(listSkills).toHaveBeenCalledTimes(1));
  fixture.state.entries = [{ ...fixture.state.entries[0]!, revision: 'two' }];
  skills.resolve([]);
  await expect(loading).rejects.toThrow('快捷指令已更新或删除');
});

it('preserves mention offsets and expands only a skill confirmed in the selected scope', async () => {
  const fixture = sourceFixture();
  const body: PromptShortcut = {
    ...value,
    prompt: 'Use $review now',
    scope: { machineId: 'machine', providerKey: 'codex' },
    mentions: [
      {
        start: 4,
        end: 11,
        label: '$review',
        target: {
          kind: 'skill',
          source: 'global',
          path: '/skills/review/SKILL.md',
          machineId: 'machine',
          compatibleProviders: ['codex'],
        },
      },
    ],
  };
  const entry = projectShortcutIndex(body, 'body');
  fixture.state.entries = [entry];
  fixture.shortcuts.read = async () => body;
  fixture.client.listSkills = async () => [
    {
      scope: 'global',
      dir: '/skills',
      truncated: false,
      skills: [
        {
          id: 'skill',
          name: 'review',
          relativePath: 'review/SKILL.md',
          absolutePath: '/skills/review/SKILL.md',
        },
      ],
    },
  ];
  expect(await preparePromptShortcut(fixture.client, entry, new AbortController().signal)).toEqual({
    text: body.prompt,
    ranges: [
      {
        start: 4,
        end: 11,
        text: '$review',
        expansion: 'use /review [Skill Path](/skills/review/SKILL.md)',
      },
    ],
  });
});

it('persists migration completion across target edits/deletion without removing legacy data or recreating targets', async () => {
  const scope = crypto.randomUUID();
  const workflow = {
    id: 'legacy',
    title: 'Old prompt',
    prompt: 'Original user text',
    includeCurrentPage: true,
    updatedAt: 1,
  };
  await saveWorkflow(scope, workflow);
  const fixture = shortcutsFixture();
  const input = {
    scope,
    shortcuts: fixture.shortcuts,
    workspaceId: 'workspace',
    userId: 'user',
    workflows: [workflow],
  };
  await migrateWorkflows(input);
  expect((await migrationStatus(scope, fixture.shortcuts))[0]!.state).toBe('pending');
  fixture.state.pendingIds = [];
  const complete = (await migrationStatus(scope, fixture.shortcuts))[0]!;
  expect(complete.completed).toBe(true);
  fixture.state.entries = [{ ...fixture.state.entries[0]!, revision: 'edited-after-import' }];
  expect((await migrationStatus(scope, fixture.shortcuts))[0]!.state).toBe('synced');
  fixture.state.entries = [];
  await migrateWorkflows(input);
  expect(fixture.save).toHaveBeenCalledTimes(1);
  expect((await migrationStatus(scope, fixture.shortcuts))[0]!.completed).toBe(true);
  expect(await loadWorkflows(scope)).toEqual([workflow]);
  const journal = JSON.parse(localStorage.getItem(`lody:automation:shortcut-migration:${scope}`)!);
  expect(journal[0].phase).toBe('completed');
});

it('reuses a staged migration identity after an unconfirmed save and never recreates an accepted deleted copy', async () => {
  const scope = crypto.randomUUID();
  const workflow = {
    id: 'legacy',
    title: 'Import me',
    prompt: 'Keep stable identity',
    includeCurrentPage: false,
    updatedAt: 1,
  };
  await saveWorkflow(scope, workflow);
  const fixture = shortcutsFixture();
  fixture.save.mockRejectedValueOnce(new Error('uncertain local persistence'));
  const input = {
    scope,
    shortcuts: fixture.shortcuts,
    workspaceId: 'workspace',
    userId: 'user',
    workflows: [workflow],
  };
  await expect(migrateWorkflows(input)).rejects.toThrow('uncertain');
  const first = fixture.save.mock.calls[0]![0];
  fixture.retry.mockRejectedValueOnce(new Error('offline'));
  await expect(migrateWorkflows(input)).rejects.toThrow('offline');
  expect(fixture.save.mock.calls[1]![0]).toEqual(first);
  fixture.state.entries = [];
  fixture.state.pendingIds = [];
  await migrateWorkflows(input);
  expect(fixture.save).toHaveBeenCalledTimes(2);
  expect((await migrationStatus(scope, fixture.shortcuts))[0]!.completed).toBe(true);
});

it('retains directory failure through local SDK publication events and clears it only on successful refresh', async () => {
  let directoryUnavailable = true;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const target = new URL(String(url));
    if (target.pathname === '/api/auth/convex/token')
      return Response.json({ token: 'header.payload.signature' });
    if (target.pathname === '/api/query')
      return directoryUnavailable
        ? new Response('Directory unavailable', { status: 503 })
        : Response.json({ status: 'success', value: [] });
    return new Response('Publication offline', { status: 503 });
  });
  const client = new SyncedShortcuts({
    accountKey: crypto.randomUUID(),
    workspaceId: 'workspace',
    userId: 'user',
    authOrigin: 'https://auth.example.test',
    convexOrigin: 'https://convex.example.test',
    getToken: () => 'session-bearer',
    requireAccess: async () => {},
  });
  try {
    await expect(client.connect()).rejects.toThrow('HTTP 503');
    const error = client.getSnapshot().errors.directory;
    expect(error).toBeInstanceOf(Error);
    await client.save({ value, base: null, bodyDocId: 'local-body' });
    await vi.waitFor(() => expect(client.getSnapshot().errors.shortcut).toBeInstanceOf(Error));
    expect(client.getSnapshot().errors.directory).toBe(error);
    expect(client.getSnapshot().errors.initialization).toBeUndefined();
    directoryUnavailable = false;
    await client.retry();
    expect(client.getSnapshot().errors.directory).toBeUndefined();
    expect(client.getSnapshot().errors.shortcut).toBeInstanceOf(Error);
  } finally {
    await client.close();
    fetch.mockRestore();
  }
});

it('makes an explicit composer retry query the real directory again without retrying on each load', async () => {
  let available = false;
  let queries = 0;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const target = new URL(String(url));
    if (target.pathname === '/api/auth/convex/token')
      return Response.json({ token: 'header.payload.signature' });
    if (target.pathname === '/api/query') {
      queries++;
      return available
        ? Response.json({ status: 'success', value: [] })
        : new Response('Directory offline', { status: 503 });
    }
    return new Response('Unexpected endpoint', { status: 404 });
  });
  const client = composerClient();
  const source = createComposerMentionSource({ client, sessionId: '', target: null });
  const signal = new AbortController().signal;
  try {
    await expect(source.load('shortcut', signal)).rejects.toThrow('HTTP 503');
    expect(queries).toBe(1);
    available = true;
    await expect(source.load('shortcut', signal)).rejects.toThrow('快捷指令同步失败');
    expect(queries).toBe(1);
    await source.retry!('shortcut', signal);
    expect(queries).toBe(2);
    expect(await source.load('shortcut', signal)).toEqual([]);
    expect(queries).toBe(2);
    const aborted = new AbortController();
    aborted.abort();
    await expect(source.retry!('shortcut', aborted.signal)).rejects.toThrow();
    expect(queries).toBe(2);
  } finally {
    await client.close();
    fetch.mockRestore();
  }
});

it('reopens after an initialization failure only when explicitly retried', async () => {
  let denied = true;
  const access = vi.fn(async () => {
    if (denied) throw new Error('Origin not authorized');
  });
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const target = new URL(String(url));
    if (target.pathname === '/api/auth/convex/token')
      return Response.json({ token: 'header.payload.signature' });
    if (target.pathname === '/api/query') return Response.json({ status: 'success', value: [] });
    return new Response('Unexpected endpoint', { status: 404 });
  });
  const client = new SyncedShortcuts({
    accountKey: crypto.randomUUID(),
    workspaceId: 'workspace',
    userId: 'user',
    authOrigin: 'https://auth.example.test',
    convexOrigin: 'https://convex.example.test',
    getToken: () => 'session-bearer',
    requireAccess: access,
  });
  try {
    await expect(client.connect()).rejects.toThrow('Origin not authorized');
    expect(access).toHaveBeenCalledTimes(2);
    denied = false;
    await expect(client.connect()).rejects.toThrow('Origin not authorized');
    expect(access).toHaveBeenCalledTimes(2);
    await client.retry();
    expect(access).toHaveBeenCalledTimes(4);
    expect(client.getSnapshot().errors).toEqual({});
    await expect(client.connect()).resolves.toBeUndefined();
  } finally {
    await client.close();
    fetch.mockRestore();
  }
});
