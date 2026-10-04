import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpSessionSubmissionGateway, SubmissionError } from '../dist/index.js';

const id = 'A0000000-0000-4000-8000-000000000001';
const normalized = id.toLowerCase();
const input = {
  requestId: id,
  machineId: 'machine',
  agentConfigId: 'config',
  title: 'Title',
  prompt: 'Hello',
  cliType: 'builtin',
  agentType: 'codex',
};

test('submission preserves the retry identity and does not equate pending with execution', async () => {
  const calls = [];
  const gateway = new HttpSessionSubmissionGateway({
    convexSiteUrl: 'https://deployment.convex.site',
    auth: { getToken: async () => 'bearer' },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return Response.json(
        { requestId: normalized, turnId: normalized, sessionId: 'share-derived', state: 'pending' },
        { status: 202 },
      );
    },
  });
  assert.equal((await gateway.submit('workspace /', input)).state, 'pending');
  await gateway.submit('workspace /', input);
  assert.equal(calls[0].options.body, calls[1].options.body);
  assert.equal(JSON.parse(calls[0].options.body).requestId, normalized);
  assert.equal(
    calls[0].url,
    'https://deployment.convex.site/api/workspaces/workspace%20%2F/session-submissions',
  );
  assert.equal(calls[0].options.headers.Authorization, 'Bearer bearer');
  assert.equal(calls[0].options.credentials, 'omit');
});

test('lookup distinguishes absence, conflict and malformed identity', async () => {
  let status = 404;
  const gateway = new HttpSessionSubmissionGateway({
    convexSiteUrl: 'https://deployment.convex.site',
    auth: { getToken: async () => 'bearer' },
    fetch: async () =>
      status === 404
        ? Response.json({ error: 'not_found' }, { status })
        : Response.json({ error: 'request_conflict' }, { status }),
  });
  assert.equal(await gateway.lookup('workspace', id), null);
  status = 409;
  await assert.rejects(
    gateway.submit('workspace', input),
    (error) =>
      error instanceof SubmissionError && error.code === 'request_conflict' && error.status === 409,
  );
  await assert.rejects(
    gateway.lookup('workspace', 'arbitrary'),
    (error) => error.code === 'invalid_request',
  );
});
