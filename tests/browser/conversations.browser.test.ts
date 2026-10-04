import type { SubmissionReceipt } from '@lody-mobile/sdk';
import { HttpSessionSubmissionGateway, SessionSubmissionService } from '@lody-mobile/sdk';
import { afterEach, expect, it } from 'vitest';

import type { ConversationIdentity } from '../../src/features/conversations/controller';
import { ConversationsController } from '../../src/features/conversations/controller';
import { createDraftStorage } from '../../src/features/conversations/draft-storage';
import { createJournalStorage } from '../../src/features/conversations/storage';

const identity: ConversationIdentity = {
  authOrigin: 'https://auth.example.test',
  clientId: 'test',
  accountId: 'account-a',
  sessionId: 'login-a',
  workspaceId: 'workspace-a',
  token: 'token-a',
  convexSiteUrl: 'https://convex.example.test',
};
const draft = {
  convexSiteUrl: identity.convexSiteUrl,
  machineId: 'machine',
  agentConfigId: 'agent',
  localProjectId: 'project',
  branch: 'main',
  modelId: 'model',
  agentType: 'codex',
  cliType: 'builtin' as const,
  title: 'Test',
  prompt: 'Hello',
};
const controllers: ConversationsController[] = [];
afterEach(() => {
  for (const controller of controllers) controller.dispose();
  controllers.length = 0;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('lody:conversation:')) localStorage.removeItem(key);
  }
});

it('persists before POST, never resends an uncertain request across reloads, and looks up the same request ID', async () => {
  let posts = 0;
  let queryUrl = '';
  const storage = createJournalStorage();
  const createApi = () =>
    new SessionSubmissionService(
      new HttpSessionSubmissionGateway({
        convexSiteUrl: identity.convexSiteUrl,
        auth: { getToken: async () => identity.token },
        fetch: async (url, options) => {
          if (options?.method === 'POST') {
            ++posts;
            expect(
              Object.keys(localStorage).some((key) => key.startsWith('lody:conversation:')),
            ).toBe(true);
            throw new TypeError('connection lost after server acceptance');
          }
          queryUrl = String(url);
          const id = queryUrl.split('/').at(-1);
          return Response.json({
            requestId: id,
            turnId: id,
            sessionId: 'server-session',
            state: 'submitted',
          });
        },
      }),
    );
  const first = new ConversationsController(storage, createApi);
  controllers.push(first);
  await first.bind(identity);
  await first.send(draft);
  const requestId = first.getSnapshot().journal?.requestId;
  expect(first.getSnapshot().journal?.state).toBe('unconfirmed');
  const restored = new ConversationsController(storage, createApi);
  controllers.push(restored);
  await restored.bind(identity);
  await restored.send(draft);
  await restored.recover();
  expect(posts).toBe(1);
  expect(queryUrl).toBe(
    `${identity.convexSiteUrl}/api/workspaces/workspace-a/session-submissions/${requestId}`,
  );
  expect(restored.getSnapshot().journal?.state).toBe('accepted');
  expect(restored.getSnapshot().journal?.receipt?.sessionId).toBe('server-session');
});

it('fences a late response when account or workspace changes, retaining the original uncertain journal', async () => {
  let resolveReceipt: ((receipt: SubmissionReceipt) => void) | undefined;
  let sentId = '';
  const storage = createJournalStorage();
  const controller = new ConversationsController(storage, () => ({
    submit: async (_workspace, input) => {
      sentId = input.requestId;
      return new Promise<SubmissionReceipt>((resolve) => {
        resolveReceipt = resolve;
      });
    },
    lookup: async () => null,
  }));
  controllers.push(controller);
  await controller.bind(identity);
  const sending = controller.send(draft);
  await expect.poll(() => sentId).not.toBe('');
  await controller.bind({
    ...identity,
    accountId: 'account-b',
    sessionId: 'login-b',
    workspaceId: 'workspace-b',
  });
  resolveReceipt?.({
    requestId: sentId,
    turnId: sentId,
    sessionId: 'old-session',
    state: 'submitted',
  });
  await sending;
  expect(controller.getSnapshot().journal).toBeNull();
  await controller.bind(identity);
  expect(controller.getSnapshot().journal?.state).toBe('unconfirmed');
  expect(controller.getSnapshot().journal?.receipt).toBeNull();
});

it('claims a journal once across concurrent controllers and blocks sending when persistence fails', async () => {
  let posts = 0;
  const storage = createJournalStorage();
  const createApi = () => ({
    submit: async () => {
      ++posts;
      throw new Error('offline');
    },
    lookup: async () => null,
  });
  const first = new ConversationsController(storage, createApi);
  const second = new ConversationsController(storage, createApi);
  controllers.push(first, second);
  await Promise.all([first.bind(identity), second.bind(identity)]);
  await Promise.all([first.send(draft), second.send(draft)]);
  expect(posts).toBe(1);
  const failed = new ConversationsController(
    {
      load: async () => null,
      claim: async () => {
        throw new Error('quota');
      },
      save: async () => {},
      clear: async () => {},
    },
    createApi,
  );
  controllers.push(failed);
  await failed.bind(identity);
  await failed.send(draft);
  expect(posts).toBe(1);
  expect(failed.getSnapshot().error).toContain('No request was sent');
});

it('restores partially typed drafts after reopening and isolates workspaces', async () => {
  const storage = createDraftStorage();
  const partial = {
    ...draft,
    prompt: 'Unsaved thought\nselected text',
    convexSiteUrl: '',
    machineId: '',
  };
  await storage.save('account-a:workspace-a', partial);
  const reopened = createDraftStorage();
  expect(await reopened.load('account-a:workspace-a')).toEqual(partial);
  expect(await reopened.load('account-a:workspace-b')).toBeNull();
});

it('omits optional model and project fields from the real submission input', async () => {
  const controller = new ConversationsController(createJournalStorage(), () => ({
    submit: async (_workspace, input) => {
      expect(input.project).toBeUndefined();
      expect(input.modelId).toBeUndefined();
      return {
        requestId: input.requestId,
        turnId: input.requestId,
        sessionId: 'session',
        state: 'submitted',
      };
    },
    lookup: async () => null,
  }));
  controllers.push(controller);
  await controller.bind(identity);
  await controller.send({ ...draft, localProjectId: '', branch: '', modelId: '' });
  expect(controller.getSnapshot().journal?.state).toBe('accepted');
});
