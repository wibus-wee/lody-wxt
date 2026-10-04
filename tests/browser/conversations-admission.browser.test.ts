import type { SessionHandle } from '@lody-mobile/sdk';
import { SessionRuntime } from '@lody-mobile/sdk';
import { expect, it } from 'vitest';

import {
  admissionInput,
  AdmissionStorage,
  resumeAdmission,
} from '../../src/features/conversations/admission';
import { TurnJournal } from '../../src/features/conversations/turn-journal';

it('preserves corrupt admission storage and blocks a new claim without crashing render', async () => {
  localStorage.setItem('lody:new-draft:corrupt-test', '{broken');
  const storage = new AdmissionStorage('corrupt-test');
  const restored = storage.load();
  expect(restored.error).not.toBeNull();
  await expect(storage.claim(restored.draft)).rejects.toThrow();
  expect(localStorage.getItem('lody:new-draft:corrupt-test')).toBe('{broken');
  localStorage.removeItem('lody:new-draft:corrupt-test');
});

it('claims a pending turn only once across surfaces and retains the winner request ID', async () => {
  const first = new TurnJournal('claim-test');
  const second = new TurnJournal('claim-test');
  await first.clear();
  const input = {
    requestId: 'winner',
    timestamp: new Date().toISOString(),
    userId: 'user',
    inputConfig: { prompt: 'hello', cliType: 'builtin' as const, agentType: 'codex' },
  };
  const turn = { sessionId: 'session', input, kind: 'dispatch' as const, expectedTurnId: '' };
  const results = await Promise.all([
    first.claim(turn),
    second.claim({ ...turn, input: { ...input, requestId: 'loser' } }),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(first.load()?.input.requestId).toBe('winner');
  await first.clear('loser');
  expect(first.load()).not.toBeNull();
  await first.clear('winner');
});

it('does not confirm admission from local turn presence without a matching dispatch metadata pointer', async () => {
  const identity = { scope: 'scope', workspaceId: 'workspace', userId: 'user' };
  const input = {
    requestId: 'request',
    timestamp: new Date().toISOString(),
    userId: 'user',
    inputConfig: { prompt: 'hello', cliType: 'builtin' as const, agentType: 'codex' },
  };
  const meta = {
    id: 'session',
    machineId: 'machine',
    userId: 'user',
    createdAt: input.timestamp,
    isArchived: false,
    title: 'Hello',
    agentConfigId: 'agent',
  };
  const admission = admissionInput(meta, input, identity);
  let pointer = '';
  const handle: SessionHandle = {
    read: () => ({
      sessionId: 'session',
      session: {},
      queue: [],
      history: [{ id: 'request', role: 'user', userId: 'user', timestamp: input.timestamp }],
    }),
    subscribe: () => () => {},
    append: async () => {},
    flush: async () => {},
    close: async () => {},
    respondPermission: async () => {},
    promote: async () => {},
  };
  const runtime = new SessionRuntime(
    {
      create: async () => {},
      list: async () => [{ ...meta, latestUserMsgId: pointer }],
      subscribe: () => () => {},
      open: async () => handle,
      patch: async () => {},
      close: async () => {},
    },
    { request: async () => null },
  );
  expect(await resumeAdmission(runtime, admission, identity, new AbortController().signal)).toBe(
    false,
  );
  pointer = 'request';
  expect(await resumeAdmission(runtime, admission, identity, new AbortController().signal)).toBe(
    true,
  );
  await expect(
    resumeAdmission(
      runtime,
      admission,
      { ...identity, userId: 'other' },
      new AbortController().signal,
    ),
  ).rejects.toThrow('identity');
});

it('restores all draft selections and attachment identifiers and refuses to replace a pending admission', async () => {
  const storage = new AdmissionStorage('restore-test');
  localStorage.removeItem('lody:new-draft:restore-test');
  const draft = storage.load().draft;
  const input = {
    requestId: 'original-request',
    timestamp: draft.createdAt,
    userId: 'user',
    inputConfig: { prompt: 'keep me', cliType: 'builtin' as const, agentType: 'codex' },
  };
  const pending = admissionInput(
    {
      id: draft.sessionId,
      machineId: 'machine',
      userId: 'user',
      createdAt: draft.createdAt,
      isArchived: false,
      title: 'Title',
      agentConfigId: 'agent',
    },
    input,
    { scope: 'restore-test', workspaceId: 'workspace', userId: 'user' },
  );
  const complete = {
    ...draft,
    machineId: 'machine',
    agentId: 'agent',
    modelId: 'model',
    projectId: 'project',
    title: 'Title',
    prompt: 'keep me',
    attachmentOrigin: 'https://files.example.test',
    blocks: [
      { type: 'image' as const, imageId: 'image', mimeType: 'image/png' as const, sizeBytes: 10 },
    ],
    pending,
  };
  expect(await storage.claim(complete)).toBe(true);
  const reopened = new AdmissionStorage('restore-test');
  expect(reopened.load().draft).toEqual(complete);
  expect(
    await reopened.claim({
      ...complete,
      pending: { ...pending, input: { ...input, requestId: 'new-request' } },
    }),
  ).toBe(false);
  expect(reopened.load().draft.pending?.input.requestId).toBe('original-request');
  await reopened.clear('original-request');
});
