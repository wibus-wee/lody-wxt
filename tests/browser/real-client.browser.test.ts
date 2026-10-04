import type { SessionMetadata, SessionSnapshot } from '@lody-mobile/sdk';
import { createLodyClient, SessionRuntime } from '@lody-mobile/sdk';
import { expect, it } from 'vitest';

import { productConfig } from '../../src/app/product-config';
import type { RealConnection } from '../../src/features/connection/real-client';
import { RealLodyClient } from '../../src/features/connection/real-client';
import { requireApiAccess, workspaceScope } from '../../src/features/connection/state';

const target = {
  workspaceId: 'workspace',
  machineId: 'machine',
  agentConfigId: 'agent',
  project: { kind: 'chat' as const },
};
function fixture(scope: string, failFlush = false, failMetadata = true) {
  const rows: SessionMetadata[] = [];
  const snapshot: SessionSnapshot = { sessionId: '', history: [], queue: [], session: {} };
  let failCreate = failMetadata;
  let creates = 0;
  let closes = 0;
  const runtime = new SessionRuntime(
    {
      list: async () => rows,
      subscribe: () => () => {},
      patch: async () => {},
      close: async () => {},
      create: async (meta) => {
        creates++;
        if (!rows.some((row) => row.id === meta.id)) rows.push(meta);
        if (failCreate) {
          failCreate = false;
          throw new Error('lost acknowledgement');
        }
      },
      open: async (sessionId) => ({
        read: () => ({ ...snapshot, sessionId }),
        subscribe: () => () => {},
        append: async (input) => {
          snapshot.history.push({
            id: input.requestId,
            role: 'user',
            timestamp: input.timestamp,
            userId: input.userId,
            inputConfig: input.inputConfig,
          });
          const meta = rows.find((row) => row.id === sessionId);
          if (meta) meta.latestUserMsgId = input.requestId;
        },
        flush: async () => {
          if (failFlush) {
            failFlush = false;
            throw new Error('lost flush acknowledgement');
          }
        },
        promote: async () => {},
        respondPermission: async () => {},
        close: async () => {},
      }),
    },
    { request: async () => null },
  );
  const machine = {
    machineId: 'machine',
    agents: [{ id: 'agent', name: 'Agent', cliType: 'builtin' as const, agentType: 'codex' }],
    projects: [],
    capabilities: {
      agent: {
        cliType: 'builtin' as const,
        agentType: 'codex',
        fetchedAt: 1,
        models: [{ modelId: 'real-model', name: 'Real model' }],
        modes: [],
        configOptions: [
          {
            id: 'plan_mode',
            name: 'Plan',
            type: 'boolean' as const,
            currentValue: false,
            options: [],
          },
          {
            id: 'fast_mode',
            name: 'Fast',
            type: 'boolean' as const,
            currentValue: false,
            options: [],
          },
          {
            id: 'reasoning_effort',
            name: 'Reasoning',
            type: 'select' as const,
            currentValue: 'high',
            options: [
              { value: 'high', name: 'High' },
              { value: 'low', name: 'Low' },
            ],
          },
        ],
      },
    },
  };
  const connection = {
    runtime,
    machines: {
      open: async () => ({
        read: () => machine,
        subscribe: () => () => {},
        archiveSession: async () => {},
        deleteSession: async () => {},
        close: async () => {},
      }),
    },
    close: async () => {
      closes++;
    },
  } satisfies RealConnection;
  const sdk = createLodyClient({ authOrigin: 'https://auth.example', clientId: 'test' });
  sdk.streams.getGrant = async () => ({
    token: 'grant',
    expiresIn: 3600,
    gatewayBaseUrl: 'https://streams.example',
  });
  const client = new RealLodyClient({
    accountKey: scope,
    accountId: 'user',
    workspaceId: 'workspace',
    authOrigin: 'https://auth.example',
    convexUrl: 'https://convex.example',
    token: 'credential',
    client: sdk,
    ports: {
      createConnection: async () => connection,
      requireAccess: async () => {},
      directory: {
        listMachines: async () => [
          { machineId: 'machine', ownerUserId: 'user', sharedWithTeam: false, updatedAt: 1 },
        ],
      },
    },
  });
  return { client, rows, snapshot, machine, creates: () => creates, closes: () => closes };
}
it('recovers the same empty metadata admission after a lost acknowledgement and sends its first turn', async () => {
  const scope = crypto.randomUUID();
  const first = fixture(scope);
  await first.client.connect();
  await expect(first.client.create(target)).rejects.toThrow('lost acknowledgement');
  const metadata = structuredClone(first.rows[0]);
  const session = await first.client.create(target);
  expect(session.id).toBe(metadata?.id);
  expect(first.rows[0]).toEqual(metadata);
  expect(first.creates()).toBe(1);
  expect(first.client.getSnapshot().admission?.phase).toBe('awaiting-first-turn');
  await first.client.send({
    sessionId: session.id,
    operationId: 'request',
    text: 'Hello',
    contexts: [],
    inputConfig: { modelId: 'real-model', reasoningEffort: '', planMode: false, fastMode: false },
  });
  expect(first.snapshot.history[0]?.id).toBe('request');
  expect(first.client.getSnapshot().admission).toBeNull();
  await first.client.close();
  await expect(first.client.list()).rejects.toThrow();
  expect(first.closes()).toBe(1);
});
it('confirms an uncertain first turn from synced history without creating another operation', async () => {
  const first = fixture(crypto.randomUUID(), true);
  await first.client.connect();
  await expect(first.client.create(target)).rejects.toThrow();
  const session = await first.client.create(target);
  await expect(
    first.client.send({
      sessionId: session.id,
      operationId: 'stable-request',
      text: 'Hello',
      contexts: [],
      inputConfig: { modelId: 'real-model', reasoningEffort: '', planMode: false, fastMode: false },
    }),
  ).rejects.toThrow('session_admission_incomplete');
  expect(first.client.getSnapshot().admission?.phase).toBe('delivery-unconfirmed');
  expect(await first.client.recoverDelivery()).toBe(true);
  expect(first.snapshot.history).toHaveLength(1);
  expect(first.snapshot.history[0]?.id).toBe('stable-request');
  expect(first.client.getSnapshot().admission).toBeNull();
  await first.client.close();
});
it('checks existing host grants without requesting permissions', async () => {
  let checks = 0;
  await expect(
    requireApiAccess('https://convex.example', {
      protocol: 'chrome-extension:',
      contains: async () => {
        checks++;
        return false;
      },
    }),
  ).rejects.toThrow('Browser host permission missing');
  expect(checks).toBe(1);
});
it('uses official product identity for durable workspace scope', () => {
  expect(
    workspaceScope(productConfig.authOrigin, productConfig.clientId, 'user', 'workspace'),
  ).toBe(JSON.stringify(['https://backend.lody.ai', 'lody-cli', 'user', 'workspace']));
  expect(productConfig.convexOrigin).toBe('https://convex.lody.ai');
});
it('explicitly recovers a metadata admission with the original identity', async () => {
  const first = fixture(crypto.randomUUID());
  await first.client.connect();
  await expect(first.client.create(target)).rejects.toThrow();
  const metadata = structuredClone(first.rows[0]);
  first.rows.length = 0;
  expect(await first.client.recoverDelivery()).toBe(true);
  expect(first.rows[0]).toEqual(metadata);
  expect(first.client.getSnapshot().admission?.phase).toBe('awaiting-first-turn');
  await first.client.close();
});
it('explicitly resumes a missing first turn with the original operation', async () => {
  const first = fixture(crypto.randomUUID(), true);
  await first.client.connect();
  await expect(first.client.create(target)).rejects.toThrow();
  const session = await first.client.create(target);
  await expect(
    first.client.send({
      sessionId: session.id,
      operationId: 'original',
      text: 'Hello',
      contexts: [],
      inputConfig: { modelId: 'real-model', reasoningEffort: '', planMode: false, fastMode: false },
    }),
  ).rejects.toThrow();
  const original = structuredClone(first.snapshot.history[0]);
  first.snapshot.history.length = 0;
  expect(await first.client.recoverDelivery()).toBe(true);
  expect(first.snapshot.history).toEqual([original]);
  await first.client.close();
});
const firstInput = {
  operationId: 'first-request',
  text: 'Hello',
  contexts: [],
  inputConfig: {
    modelId: 'real-model',
    reasoningEffort: '',
    planMode: false,
    fastMode: false,
    configOptionValues: { plan_mode: false, fast_mode: true },
  },
};
it('keeps the combined reference prompt immutable when recovering uncertain delivery', async () => {
  const scope = crypto.randomUUID();
  const first = fixture(scope, true, false);
  await first.client.connect();
  const contexts = [
    {
      id: 'page',
      kind: 'page' as const,
      title: 'Reference',
      url: 'https://example.com',
      text: 'Attached page content',
      trust: 'untrusted' as const,
    },
  ];
  await expect(first.client.start(target, { ...firstInput, contexts })).rejects.toThrow();
  const original = structuredClone(first.snapshot.history[0]);
  expect(original?.inputConfig?.prompt).toContain('Hello');
  expect(original?.inputConfig?.prompt).toContain('Attached page content');
  expect(original?.inputConfig?.inputBlocks).toEqual([
    { type: 'text', text: original?.inputConfig?.prompt },
  ]);
  expect(await first.client.recoverDelivery()).toBe(true);
  expect(first.snapshot.history).toEqual([original]);
  await first.client.close();
});
it('starts real first turns with both boolean values and no enumerated boolean choices', async () => {
  for (const value of [false, true]) {
    const first = fixture(crypto.randomUUID(), false, false);
    await first.client.connect();
    const session = await first.client.start(target, {
      ...firstInput,
      inputConfig: {
        ...firstInput.inputConfig,
        configOptionValues: { plan_mode: value, fast_mode: !value },
      },
    });
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]?.id).toBe(session.id);
    expect(first.rows[0]?.latestUserMsgId).toBe('first-request');
    expect(first.snapshot.history[0]?.inputConfig?.configOptionValues).toEqual({
      plan_mode: value,
      fast_mode: !value,
    });
    expect(first.client.getSnapshot().admission).toBeNull();
    await first.client.close();
  }
});
it('rejects invalid first-turn configuration before creating metadata or journals', async () => {
  const scope = crypto.randomUUID();
  const first = fixture(scope, false, false);
  await first.client.connect();
  for (const inputConfig of [
    { ...firstInput.inputConfig, modelId: 'missing' },
    { ...firstInput.inputConfig, configOptionValues: { plan_mode: 'false' } },
    { ...firstInput.inputConfig, configOptionValues: { removed: false } },
    { ...firstInput.inputConfig, configOptionValues: { reasoning_effort: 'missing' } },
    {
      ...firstInput.inputConfig,
      reasoningEffort: 'high',
      configOptionValues: { reasoning_effort: 'low' },
    },
  ]) {
    await expect(first.client.start(target, { ...firstInput, inputConfig })).rejects.toThrow();
    expect(first.creates()).toBe(0);
    expect(first.rows).toEqual([]);
    for (const prefix of ['create', 'turn', 'admission'])
      expect(localStorage.getItem(`lody:real-${prefix}:${scope}`)).toBeNull();
  }
  await expect(first.client.start(target, { ...firstInput, text: ' ' })).rejects.toThrow('message');
  expect(first.creates()).toBe(0);
  await first.client.close();
});
it('uses the existing empty admission after corrected configuration without allocating another session', async () => {
  const first = fixture(crypto.randomUUID());
  await first.client.connect();
  await expect(first.client.create(target)).rejects.toThrow('lost acknowledgement');
  const original = structuredClone(first.rows[0]);
  await expect(
    first.client.start(target, {
      ...firstInput,
      inputConfig: { ...firstInput.inputConfig, modelId: 'missing' },
    }),
  ).rejects.toThrow('available model');
  const session = await first.client.start(target, firstInput);
  expect(session.id).toBe(original?.id);
  expect(first.creates()).toBe(2);
  expect(first.rows).toHaveLength(1);
  expect(first.snapshot.history[0]?.id).toBe('first-request');
  await first.client.close();
});
it('keeps uncertain requests immutable and recovers their original request ID and configuration', async () => {
  const scope = crypto.randomUUID();
  const first = fixture(scope, true, false);
  await first.client.connect();
  await expect(first.client.start(target, firstInput)).rejects.toThrow(
    'session_admission_incomplete',
  );
  const journal = localStorage.getItem(`lody:real-turn:${scope}`);
  await expect(
    first.client.start(target, {
      ...firstInput,
      inputConfig: {
        ...firstInput.inputConfig,
        configOptionValues: { plan_mode: true, fast_mode: true },
      },
    }),
  ).rejects.toThrow('immutable');
  expect(localStorage.getItem(`lody:real-turn:${scope}`)).toBe(journal);
  expect(first.creates()).toBe(1);
  expect(await first.client.recoverDelivery()).toBe(true);
  expect(first.snapshot.history).toHaveLength(1);
  expect(first.snapshot.history[0]?.id).toBe('first-request');
  expect(first.snapshot.history[0]?.inputConfig?.configOptionValues).toEqual(
    firstInput.inputConfig.configOptionValues,
  );
  await first.client.close();
});

it('selects the only assistant without creating a conversation and restores an explicit choice', async () => {
  const scope = crypto.randomUUID();
  const first = fixture(scope);
  first.machine.agents.push({
    ...first.machine.agents[0]!,
    id: 'other-agent',
    name: 'Other Agent',
  });
  await first.client.connect();
  expect(first.client.getSnapshot().selectedMachineId).toBe('machine');
  expect(first.client.getSnapshot().target).toBeNull();
  await first.client.selectTarget(target);
  expect(first.client.getSnapshot().target).toEqual(target);
  expect(first.rows).toEqual([]);
  await first.client.close();

  const restored = fixture(scope);
  restored.machine.agents.push({
    ...restored.machine.agents[0]!,
    id: 'other-agent',
    name: 'Other Agent',
  });
  await restored.client.connect();
  expect(restored.client.getSnapshot().target).toEqual(target);
  expect(restored.rows).toEqual([]);
  await restored.client.close();

  const isolated = fixture(crypto.randomUUID());
  isolated.machine.agents.push({
    ...isolated.machine.agents[0]!,
    id: 'other-agent',
    name: 'Other Agent',
  });
  await isolated.client.connect();
  expect(isolated.client.getSnapshot().target).toBeNull();
  await isolated.client.close();
});

it('keeps a removed remembered assistant visible as an error without choosing another agent', async () => {
  const scope = crypto.randomUUID();
  localStorage.setItem(
    `lody:chat-target:${scope}`,
    JSON.stringify({ machineId: 'machine', agentConfigId: 'removed-agent' }),
  );
  const current = fixture(scope);
  await current.client.connect();
  expect(current.client.getSnapshot().status).toBe('connected');
  expect(current.client.getSnapshot().target).toBeNull();
  expect(current.client.getSnapshot().error).toContain('Select an agent');
  expect(current.rows).toEqual([]);
  await current.client.close();
});

it('releases legacy metadata-only reservations on reconnect without sending or deleting cloud history', async () => {
  const scope = crypto.randomUUID();
  const first = fixture(scope);
  await first.client.connect();
  await expect(first.client.create(target)).rejects.toThrow('lost acknowledgement');
  const draftKey = `lody:chat-draft:${scope}:new`;
  const draft = JSON.stringify({ text: 'Unsent thought', contexts: [] });
  localStorage.setItem(draftKey, draft);
  await first.client.close();

  const restored = fixture(scope, false, false);
  restored.rows.push(...structuredClone(first.rows));
  await restored.client.connect();
  expect(restored.client.getSnapshot().admission).toBeNull();
  expect(restored.client.getSnapshot().error).toBeNull();
  expect(restored.rows).toEqual(first.rows);
  expect(restored.creates()).toBe(0);
  expect(restored.snapshot.history).toEqual([]);
  expect(localStorage.getItem(`lody:real-create:${scope}`)).toBeNull();
  expect(localStorage.getItem(draftKey)).toBe(draft);
  await restored.client.start(target, firstInput);
  expect(restored.snapshot.history[0]?.id).toBe(firstInput.operationId);
  await restored.client.close();
});

it.each([false, true])(
  'preserves actual first-turn recovery on reconnect with an interrupted cleanup: %s',
  async (interruptedCleanup) => {
    const scope = crypto.randomUUID();
    const first = fixture(scope, true, false);
    await first.client.connect();
    await expect(first.client.start(target, firstInput)).rejects.toThrow(
      'session_admission_incomplete',
    );
    if (interruptedCleanup) {
      localStorage.removeItem(`lody:real-turn:${scope}`);
      localStorage.removeItem(`lody:real-create:${scope}`);
    }
    await first.client.close();
    const restored = fixture(scope, false, false);
    restored.rows.push(...structuredClone(first.rows));
    restored.snapshot.history.push(...structuredClone(first.snapshot.history));
    await restored.client.connect();
    expect(restored.client.getSnapshot().admission).toMatchObject({
      phase: 'delivery-unconfirmed',
      operationId: firstInput.operationId,
    });
    expect(restored.client.getSnapshot().error).toBeNull();
    expect(await restored.client.recoverDelivery()).toBe(true);
    expect(restored.creates()).toBe(0);
    expect(restored.snapshot.history).toHaveLength(1);
    for (const prefix of ['create', 'turn', 'admission'])
      expect(localStorage.getItem(`lody:real-${prefix}:${scope}`)).toBeNull();
    await restored.client.close();
  },
);

it('keeps invalid legacy admission identity visible and leaves its storage intact', async () => {
  const scope = crypto.randomUUID();
  const key = `lody:real-create:${scope}`;
  const saved = JSON.stringify({
    scope: 'another-workspace',
    metadata: {
      id: 'legacy',
      machineId: 'machine',
      agentConfigId: 'agent',
      userId: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
      isArchived: false,
    },
  });
  localStorage.setItem(key, saved);
  const restored = fixture(scope);
  await expect(restored.client.connect()).rejects.toThrow('identity mismatch');
  expect(restored.client.getSnapshot().error).toContain('identity mismatch');
  expect(localStorage.getItem(key)).toBe(saved);
  expect(restored.creates()).toBe(0);
  await restored.client.close();
});
