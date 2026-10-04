import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { StreamsMachineCommands } from '@lody-mobile/sdk';
import { LoroSessionRepository } from '@lody-mobile/sdk/loro';

async function main() {
  const checkout = process.argv[2];
  if (!checkout)
    throw new Error(
      'Usage: node --import tsx tools/sdk/verify-upstream.mjs <installed-lody-oss-checkout>',
    );
  const upstream = resolve(checkout);
  const upstreamRequire = createRequire(resolve(upstream, 'packages/shared/package.json'));
  const sdkRequire = createRequire(
    new URL('../../packages/lody-sdk/package.json', import.meta.url),
  );
  const { LoroDoc } = sdkRequire('loro-crdt');
  const { Mirror } = upstreamRequire('loro-mirror');
  const { sessionDocSchema } = await import(
    pathToFileURL(resolve(upstream, 'packages/shared/src/schema.ts')).href
  );
  const { MachineAcpBinaryProgressMessageSchema, MachineAcpCapabilitiesRefreshResponseSchema } =
    await import(pathToFileURL(resolve(upstream, 'packages/shared/src/message-schemas.ts')).href);
  const doc = new LoroDoc();
  let metadata = { messageQueueCheckedAt: Date.now() };
  const repository = new LoroSessionRepository({
    repo: {
      acquireDoc: async () => ({ doc, release: async () => {} }),
      joinDocRoom: async () => ({
        firstSyncedWithRemote: Promise.resolve(),
        waitUntilSynced: async () => {},
        unsubscribe() {},
      }),
      persistDocNow: async () => {},
      getDocMeta: async () => ({ meta: metadata }),
      upsertDocMeta: async (_, patch) => {
        metadata = { ...metadata, ...patch };
      },
      persistMetaNow: async () => {},
    },
    metaRoom: { waitUntilSynced: async () => {} },
  });
  const handle = await repository.open('session');
  const input = {
    requestId: 'turn',
    userId: 'user',
    timestamp: '2026-10-04T00:00:00Z',
    inputConfig: {
      prompt: 'hello',
      cliType: 'builtin',
      agentType: 'claude',
      inputBlocks: [{ type: 'text', text: 'hello' }],
      configOptionValues: { effort: 'low' },
    },
  };
  let mirror;
  try {
    await handle.append(input, 'queue');
    mirror = new Mirror({ doc, schema: sessionDocSchema });
    const row = mirror.getState().mq[0];
    assert.equal(row.userTurnId, input.requestId);
    assert.equal(row.operationId, 'queue:turn');
    assert.deepEqual(row.acpSessionConfig.inputBlocks, input.inputConfig.inputBlocks);
    assert.deepEqual(row.acpSessionConfig.configOptionValues, input.inputConfig.configOptionValues);
    assert.ok(metadata.messageQueueUpdatedAt > metadata.messageQueueCheckedAt);
    mirror.setState((draft) => {
      draft.mq[0].task = 'edited in Lody';
    });
    assert.equal(handle.read().queue[0].task, 'edited in Lody');
  } finally {
    mirror?.dispose();
    await repository.close();
  }

  const progress = MachineAcpBinaryProgressMessageSchema.parse({
    type: 'machine/acp-binary-progress',
    machineId: 'machine',
    agentType: 'claude',
    status: 'downloading',
    percent: 1,
  });
  const final = MachineAcpCapabilitiesRefreshResponseSchema.parse({
    type: 'machine/acp-capabilities-refresh_response',
    machineId: 'machine',
    configId: 'agent',
    cliType: 'builtin',
    agentType: 'claude',
    success: false,
    error: 'upstream failure',
  });
  let receive;
  let signal;
  const commands = new StreamsMachineCommands({
    workspaceId: 'workspace',
    streams: {
      ensure: async () => {},
      subscribe: async (_, listener, subscriptionSignal) => {
        receive = listener;
        signal = subscriptionSignal;
      },
      append: async () => {
        const send = (result) =>
          receive({ jsonrpc: '2.0', rpcVersion: '1', id: 'request', result });
        send(progress);
        await new Promise((done) => setImmediate(done));
        assert.equal(signal.aborted, false);
        send(final);
      },
    },
  });
  assert.deepEqual(
    await commands.request(
      'machine',
      'machine/acp-capabilities-refresh',
      { configId: 'agent' },
      'request',
    ),
    final,
  );
  assert.equal(signal.aborted, true);
  const revision = execFileSync('git', ['-C', upstream, 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  process.stdout.write(
    `Lody ${revision}: SDK queue read/edit through upstream Mirror and progress/final RPC schemas passed.\n`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
