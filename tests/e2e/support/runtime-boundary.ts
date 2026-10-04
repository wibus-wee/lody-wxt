import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';

import type { BrowserContext } from '@playwright/test';
import * as v from 'valibot';

const requireSdk = createRequire(
  new URL('../../../packages/lody-sdk/package.json', import.meta.url),
);
const { Flock } = requireSdk(
  '@loro-dev/flock-wasm',
) as typeof import('../../../packages/lody-sdk/node_modules/@loro-dev/flock-wasm/nodejs/index');
const { LoroDoc, LoroMap, LoroList, LoroText } = requireSdk(
  'loro-crdt',
) as typeof import('../../../packages/lody-sdk/node_modules/loro-crdt');
const streamToken = 'controlled-stream-token';
const origin = 'https://api.lody.ai';

export class RuntimeBoundary {
  reads: string[] = [];
  traffic: { stream: string; kind: string; offset: number; sent?: number[] }[] = [];
  private snapshots = new Map<string, Uint8Array>();
  private documents = new Map<string, InstanceType<typeof LoroDoc>>();
  private flocks = new Map<string, InstanceType<typeof Flock>>();
  private updates = new Map<string, { offset: number; bytes: Uint8Array }[]>();
  disconnected = false;
  disconnectReads = 0;
  cancelRequests: { sessionId: string; turnId: string }[] = [];
  denyCommandResponses = false;
  private connectionGate = Promise.resolve();
  releaseConnection = () => {};

  holdConnection() {
    this.connectionGate = new Promise((resolve) => {
      this.releaseConnection = resolve;
    });
  }

  document(sessionId: string) {
    const stream = `workspace-a:s:${sessionId}`;
    let doc = this.documents.get(stream);
    if (!doc) {
      doc = new LoroDoc();
      const snapshot = this.snapshots.get(stream);
      if (snapshot) doc.import(snapshot);
      this.documents.set(stream, doc);
    }
    return doc;
  }

  submittedQuestions(prompt: string) {
    const history = v.parse(
      v.array(
        v.looseObject({
          role: v.string(),
          inputConfig: v.exactOptional(v.looseObject({ prompt: v.exactOptional(v.string()) })),
        }),
      ),
      this.document('history-a').getList('history').toJSON(),
    );
    return history.filter((turn) => turn.role === 'user' && turn.inputConfig?.prompt === prompt)
      .length;
  }

  submittedTurn(sessionId = 'history-a') {
    const history = this.document(sessionId).getList('history');
    const turn = v.parse(
      v.object({
        id: v.string(),
        timestamp: v.string(),
        userId: v.string(),
        inputConfig: v.record(v.string(), v.unknown()),
      }),
      history.toJSON().at(-1),
    );
    return {
      requestId: turn.id,
      timestamp: turn.timestamp,
      userId: turn.userId,
      inputConfig: turn.inputConfig,
    };
  }

  repairReplyIdentity(sessionId: string) {
    this.changeSession(sessionId, (doc) => {
      const history = doc.getList('history');
      const turn = history.get(history.length - 1);
      assert.ok(turn instanceof LoroMap);
      turn.set('id', 'live-answer');
    });
  }

  private offset(stream: string) {
    return this.updates.get(stream)?.at(-1)?.offset ?? 100;
  }

  private record(stream: string, bytes: Uint8Array) {
    const rows = this.updates.get(stream) ?? [];
    rows.push({ offset: this.offset(stream) + 1, bytes });
    this.updates.set(stream, rows);
    this.traffic.push({ stream, kind: 'append', offset: this.offset(stream) });
  }

  changeSession(sessionId: string, change: (doc: InstanceType<typeof LoroDoc>) => void) {
    const doc = this.document(sessionId);
    const version = doc.version();
    change(doc);
    doc.commit();
    this.snapshots.set(`workspace-a:s:${sessionId}`, doc.export({ mode: 'snapshot' }));
    this.record(`workspace-a:s:${sessionId}`, doc.export({ mode: 'update', from: version }));
  }

  beginReply(sessionId: string, withPermission = false) {
    this.changeSession(sessionId, (doc) => {
      const history = doc.getList('history');
      const last = history.get(history.length - 1);
      if (last instanceof LoroMap && last.get('role') === 'user') last.set('status', 'handled');
      const turn = history.insertContainer(history.length, new LoroMap());
      turn.set('id', 'live-answer');
      turn.set('role', 'assistant');
      turn.set('timestamp', '2026-10-04T00:00:00.000Z');
      turn.set('finished', false);
      const items = turn.setContainer('items', new LoroList());
      const item = items.insertContainer(0, new LoroMap());
      item.set('type', 'text');
      item.setContainer('text', new LoroText()).update('正在分析网页');
      const tool = items.insertContainer(1, new LoroMap());
      tool.set('type', 'tool_call');
      tool.set('toolCallId', 'read-page');
      tool.set('title', '读取页面内容');
      tool.set('status', 'in_progress');
      tool.set('content', [
        { type: 'terminal_command', command: 'read page.html' },
        { type: 'terminal_output', output: 'Verified page contents' },
      ]);
      if (withPermission) {
        const permission = tool.setContainer('permissionRequest', new LoroMap());
        permission.set('requestId', 'page-permission');
        permission.set('options', [
          { optionId: 'allow_once', name: '允许一次', kind: 'allow_once' },
        ]);
      }
    });
  }

  reply(sessionId: string) {
    const turn = this.document(sessionId)
      .getList('history')
      .toArray()
      .find((item) => item instanceof LoroMap && item.get('id') === 'live-answer');
    assert.ok(turn instanceof LoroMap);
    return turn;
  }

  finishReply(sessionId: string, status = 'handled') {
    this.changeSession(sessionId, () => {
      const turn = this.reply(sessionId);
      turn.set('finished', true);
      turn.set('status', status);
      const items = turn.get('items');
      assert.ok(items instanceof LoroList);
      const text = items.get(0);
      assert.ok(text instanceof LoroMap);
      const content = text.get('text');
      assert.ok(content instanceof LoroText);
      content.update('网页分析完成：这是一个协作项目。');
      const tool = items.get(1);
      assert.ok(tool instanceof LoroMap);
      tool.set('status', 'completed');
    });
  }

  private accept(stream: string, body: Buffer) {
    for (let cursor = 0; cursor < body.length;) {
      const length = body.readUInt32BE(cursor);
      cursor += 4;
      assert.ok(cursor + length <= body.length, 'Complete Streams binary frame');
      const bytes = body.subarray(cursor, cursor + length);
      cursor += length;
      if (stream.startsWith('workspace-a:s:')) {
        const doc = this.document(stream.slice('workspace-a:s:'.length));
        doc.import(bytes);
        this.snapshots.set(stream, doc.export({ mode: 'snapshot' }));
      } else {
        let flock = this.flocks.get(stream);
        if (!flock) {
          const snapshot = this.snapshots.get(stream);
          assert.ok(snapshot, `Known Flock ${stream}`);
          flock = Flock.fromFile(snapshot);
          this.flocks.set(stream, flock);
        }
        flock.importJson(JSON.parse(new TextDecoder().decode(bytes)));
        this.snapshots.set(stream, flock.exportFile());
      }
      this.record(stream, bytes);
    }
  }

  constructor(
    options: {
      modelControls?: boolean;
      modeOption?: string;
      configOnlyMode?: boolean;
      recentHistory?: boolean;
      agent?: {
        cliType: 'builtin' | 'registry' | 'custom';
        agentType: string;
        brandId?: string;
        env?: Record<string, string>;
      };
    } = {},
  ) {
    const meta = new Flock();
    const metadata = {
      machineId: 'machine-a',
      userId: 'user-a',
      title: 'Historical conversation',
      agentConfigId: 'agent-a',
      createdAt: '2026-01-01T00:00:00.000Z',
      isArchived: false,
    };
    meta.set(['e', 'session-history-a'], true);
    for (const [key, value] of Object.entries(metadata))
      meta.set(['m', 'session-history-a', key], value);
    if (options.recentHistory) {
      meta.set(['m', 'session-history-a', 'lastMessageAt'], Date.parse('2026-10-03T00:00:00Z'));
      meta.set(['e', 'session-newer'], true);
      for (const [key, value] of Object.entries({
        ...metadata,
        title: 'Newer but quiet conversation',
        createdAt: '2026-09-01T00:00:00Z',
      }))
        meta.set(['m', 'session-newer', key], value);
    }
    meta.commit();
    this.snapshots.set('workspace-a:meta', meta.exportFile());
    const machine = new Flock();
    machine.set(['agentConfig', 'agent-a'], {
      id: 'agent-a',
      name: 'Controlled Agent',
      cliType: 'builtin',
      agentType: 'claude',
      ...options.agent,
    });
    machine.set(['acpCapability', 'agent-a'], {
      cliType: options.agent?.cliType ?? 'builtin',
      agentType: options.agent?.agentType ?? 'claude',
      fetchedAt: Date.now(),
      models: [{ modelId: 'model-a', name: 'Controlled model' }],
      modes: [{ id: 'read-only', name: 'Read-only' }],
    });
    if (options.modeOption) {
      machine.set(['acpCapability', 'agent-a'], {
        cliType: 'builtin',
        agentType: 'claude',
        fetchedAt: Date.now(),
        models: [{ modelId: 'model-a', name: 'Controlled model' }],
        modes: options.configOnlyMode
          ? []
          : [
              { id: 'read-only', name: 'Read-only' },
              { id: 'ask', name: 'Ask' },
            ],
        configOptions: [
          {
            id: options.modeOption,
            name: 'Mode',
            type: 'select',
            currentValue: 'ask',
            options: [
              { value: 'read-only', name: 'Read-only' },
              { value: 'ask', name: 'Ask' },
            ],
          },
        ],
      });
    }
    if (options.modelControls) {
      machine.set(['acpCapability', 'agent-a'], {
        cliType: 'builtin',
        agentType: 'claude',
        fetchedAt: Date.now(),
        sourceVersion: 'v1',
        models: [
          { modelId: 'model-a', name: 'Model A' },
          { modelId: 'model-b', name: 'Model B' },
        ],
        modes: [],
        configOptions: [
          {
            id: 'effort',
            name: 'Effort',
            type: 'select',
            currentValue: 'high',
            options: [
              { value: 'high', name: 'High' },
              { value: 'low', name: 'Low' },
            ],
          },
          { id: 'fast', name: 'Fast mode', type: 'boolean', currentValue: true, options: [] },
        ],
      });
      machine.set(['acpModelCapability', 'agent-a'], {
        version: 1,
        sourceVersion: 'v1',
        models: {
          'model-a': { effortValues: ['high'], fastMode: true },
          'model-b': { effortValues: ['low'], fastMode: false },
        },
      });
    }
    machine.commit();
    this.snapshots.set('workspace-a:mf:machine-a', machine.exportFile());
    const doc = new LoroDoc();
    const history = doc.getList('history');
    const user = history.insertContainer(0, new LoroMap());
    user.set('id', 'previous-user-turn');
    user.set('role', 'user');
    user.set('timestamp', '2026-01-01T00:00:00.000Z');
    user.set('userId', 'user-a');
    user.set('finished', true);
    const input = user.setContainer('inputConfig', new LoroMap());
    input.set('prompt', 'Previously asked question');
    input.set('cliType', 'builtin');
    input.set('agentType', 'claude');
    const assistant = history.insertContainer(1, new LoroMap());
    assistant.set('id', 'previous-assistant-turn');
    assistant.set('role', 'assistant');
    assistant.set('finished', true);
    assistant.set('timestamp', '2026-01-01T00:00:01.000Z');
    assistant.set('items', [
      { type: 'text', text: 'Answer restored from real Loro snapshot\n\n' },
      {
        type: 'text',
        text: '## Cloud history\n\n```typescript\nconst source = "controlled HTTP snapshot";\n```\n\n| Boundary | Evidence |\n| --- | --- |\n| History | Loro snapshot |\n\n<script>alert(1)</script> [unsafe](javascript:alert(1))',
      },
      {
        type: 'tool_call',
        id: 'read-history',
        title: 'Read cloud history',
        name: 'read_file',
        status: 'completed',
        command: 'read README.md',
        output: 'Controlled tool output from cloud history',
      },
    ]);
    doc.commit();
    this.snapshots.set('workspace-a:s:history-a', doc.export({ mode: 'snapshot' }));
  }

  async install(context: BrowserContext) {
    await context.route('https://api.lody.ai/**', async (route) => {
      const request = route.request();
      assert.equal(request.headers().authorization, `Bearer ${streamToken}`);
      const url = new URL(request.url());
      const stream = decodeURIComponent(url.pathname.split('/')[3]!);
      if (this.denyCommandResponses && stream.includes(':rpc:res:') && request.method() === 'GET') {
        await route.fulfill({ status: 403, body: 'Controlled command response denial' });
        return;
      }
      if (url.pathname.endsWith('/bootstrap')) {
        await this.connectionGate;
        this.reads.push(stream);
        const bytes =
          this.snapshots.get(stream) ??
          (stream.startsWith('workspace-a:s:')
            ? new LoroDoc().export({ mode: 'snapshot' })
            : undefined);
        assert.ok(bytes, `Known stream ${stream}`);
        await route.fulfill({
          status: 200,
          headers: {
            'access-control-expose-headers':
              'Stream-Next-Offset, Stream-Snapshot-Offset, Stream-Up-To-Date',
            'content-type': 'multipart/mixed; boundary=lody-test',
            'stream-next-offset': String(this.offset(stream)),
            'stream-snapshot-offset': String(this.offset(stream)),
            'stream-up-to-date': 'true',
          },
          body: Buffer.concat([
            Buffer.from('--lody-test\r\nContent-Type: application/octet-stream\r\n\r\n'),
            Buffer.from(bytes),
            Buffer.from('\r\n--lody-test--\r\n'),
          ]),
        });
      } else if (request.method() === 'POST') {
        const body = request.postDataBuffer();
        assert.ok(body);
        if (stream.includes(':rpc:req:')) {
          const message = v.parse(
            v.object({
              jsonrpc: v.literal('2.0'),
              rpcVersion: v.literal('1'),
              id: v.string(),
              method: v.literal('session/cancel'),
              replyTo: v.string(),
              params: v.object({ sessionId: v.string(), turnId: v.string() }),
            }),
            JSON.parse(body.toString()),
          );
          this.cancelRequests.push(message.params);
          this.changeSession(message.params.sessionId, () => {
            const turn = this.reply(message.params.sessionId);
            assert.equal(turn.get('id'), message.params.turnId);
            turn.set('status', 'canceled');
            turn.set('finished', true);
          });
          this.record(
            message.replyTo,
            Buffer.from(
              JSON.stringify([
                {
                  jsonrpc: '2.0',
                  rpcVersion: '1',
                  id: message.id,
                  result: {
                    type: 'session/cancel_response',
                    sessionId: message.params.sessionId,
                    success: true,
                  },
                },
              ]),
            ),
          );
        } else this.accept(stream, body);
        await route.fulfill({
          status: 200,
          headers: {
            'stream-next-offset': String(this.offset(stream)),
            'access-control-expose-headers': 'Stream-Next-Offset',
          },
          body: '',
        });
      } else if (url.searchParams.get('live') === 'sse') {
        const offset =
          url.searchParams.get('offset') === 'now'
            ? this.offset(stream)
            : Number(url.searchParams.get('offset') ?? 100);
        if (this.disconnected) {
          this.disconnectReads++;
          await route.fulfill({ status: 503, body: 'Controlled disconnect' });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
        const updates = (this.updates.get(stream) ?? []).filter((row) => row.offset > offset);
        this.traffic.push({ stream, kind: 'sse', offset, sent: updates.map((row) => row.offset) });
        const events = updates
          .map((row) => `event: data\ndata: ${Buffer.from(row.bytes).toString('base64')}\n\n`)
          .join('');
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            'stream-sse-data-encoding': 'base64',
            'access-control-expose-headers': 'Stream-Sse-Data-Encoding',
          },
          body: `${events}event: control\ndata: ${JSON.stringify({ streamNextOffset: String(this.offset(stream)), upToDate: true })}\n\n`,
        });
      } else if (request.method() === 'GET') {
        const offset = Number(url.searchParams.get('offset') ?? 100);
        const updates = (this.updates.get(stream) ?? []).filter((row) => row.offset > offset);
        this.traffic.push({ stream, kind: 'read', offset, sent: updates.map((row) => row.offset) });
        await route.fulfill({
          status: 200,
          headers: {
            'access-control-expose-headers':
              'Stream-Next-Offset, Stream-Snapshot-Offset, Stream-Up-To-Date',
            'content-type': 'application/octet-stream',
            'stream-next-offset': String(this.offset(stream)),
            'stream-up-to-date': 'true',
          },
          body: Buffer.concat(
            updates.map(({ bytes }) => {
              const length = Buffer.alloc(4);
              length.writeUInt32BE(bytes.length);
              return Buffer.concat([length, Buffer.from(bytes)]);
            }),
          ),
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': stream.includes(':rpc:')
              ? 'application/json'
              : 'application/octet-stream',
            'stream-ttl': '86400',
            'stream-next-offset': String(this.offset(stream)),
            'access-control-expose-headers': 'Stream-Next-Offset, Stream-TTL',
          },
          body: '',
        });
      }
    });
    await context.route('https://backend.lody.ai/api/auth/convex/token', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ token: 'controlled.convex.jwt' }),
      });
    });
    await context.route('https://convex.lody.ai/api/query', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          value: [
            {
              machineId: 'machine-a',
              ownerUserId: 'user-a',
              sharedWithTeam: false,
              updatedAt: Date.now(),
            },
          ],
        }),
      });
    });
    await context.route('https://backend.lody.ai/api/loro-streams/token', async (route) => {
      const body: unknown = route.request().postDataJSON();
      assert.deepEqual(v.parse(v.object({ workspaceId: v.string() }), body), {
        workspaceId: 'workspace-a',
      });
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ token: streamToken, expiresIn: 3600, gatewayBaseUrl: origin }),
      });
    });
  }
}
