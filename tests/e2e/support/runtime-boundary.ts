import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';

import type { BrowserContext } from '@playwright/test';
import * as v from 'valibot';

import { finalWorkItems, workItems } from '../../fixtures/assistant-work';
import { SharingBoundary } from './sharing-boundary';
import { ShortcutBoundary } from './shortcut-boundary';

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
  readonly sharing = new SharingBoundary();
  readonly shortcuts = new ShortcutBoundary();
  readonly skillRequests: Record<string, unknown>[] = [];
  readonly editRequests: {
    requestId: string;
    sessionId: string;
    expectedUserTurnId: string;
    replacementUserTurnId: string;
    requestedByUserId: string;
    timestamp: string;
    inputConfig: Record<string, unknown>;
  }[] = [];
  readonly forkRequests: {
    requestId: string;
    sourceSessionId: string;
    sourceTurnId: string;
    targetSessionId: string;
  }[] = [];
  loseNextEditConfirmation = false;
  loseNextSteerConfirmation = false;
  private unconfirmedSteers = new Set<string>();
  readonly steerTransmissions: string[] = [];
  readonly steerRequests: {
    requestId: string;
    sessionId: string;
    expectedTurnId: string;
    userTurnId: string;
  }[] = [];
  readonly deleteRequests: string[] = [];
  completeDeleteCommands = false;

  confirmSteer(sessionId: string, turnId: string) {
    this.changeSession(sessionId, (doc) => {
      const turn = doc
        .getList('history')
        .toArray()
        .find((row) => row instanceof LoroMap && row.get('id') === turnId);
      assert.ok(turn instanceof LoroMap);
      turn.set('status', 'handled');
    });
  }

  private deleteSessionMetadata(sessionId: string) {
    const stream = 'workspace-a:meta';
    const flock = this.flocks.get(stream) ?? Flock.fromFile(this.snapshots.get(stream)!);
    const version = flock.version();
    flock.set(['e', `session-${sessionId}`], false);
    flock.commit();
    this.flocks.set(stream, flock);
    this.snapshots.set(stream, flock.exportFile());
    this.record(stream, new TextEncoder().encode(JSON.stringify(flock.exportJson(version))));
  }
  private mutationInputs = new Map<string, Record<string, unknown>>();
  queuedMessages(sessionId = 'history-a') {
    return v.parse(
      v.array(
        v.object({
          task: v.string(),
          userId: v.string(),
          timestamp: v.string(),
          userTurnId: v.string(),
          operationId: v.string(),
          acpSessionConfig: v.record(v.string(), v.unknown()),
        }),
      ),
      this.document(sessionId).getMovableList('mq').toJSON(),
    );
  }
  historyTurnIds(sessionId = 'history-a') {
    return v
      .parse(
        v.array(v.object({ id: v.string() })),
        this.document(sessionId).getList('history').toJSON(),
      )
      .map((turn) => turn.id);
  }

  reads: string[] = [];
  traffic: { stream: string; kind: string; offset: number; sent?: number[] }[] = [];
  private snapshots = new Map<string, Uint8Array>();
  private documents = new Map<string, InstanceType<typeof LoroDoc>>();
  private flocks = new Map<string, InstanceType<typeof Flock>>();
  private updates = new Map<string, { offset: number; bytes: Uint8Array }[]>();
  private rejectNextScheduleRegistry = false;
  disconnected = false;
  disconnectReads = 0;
  cancelRequests: { sessionId: string; turnId: string }[] = [];
  archiveRequests: { sessionId: string; requestedBy: string; requestedAt: number }[] = [];
  deferArchiveCommands = false;
  private seenMachineCommands = new Set<string>();
  denyCommandResponses = false;
  denyMachineWrites = false;
  deniedMachineWrites: string[] = [];
  loseNextWriteConfirmation = false;
  private unconfirmedStream: string | null = null;
  restoreWriteConfirmation() {
    this.unconfirmedStream = null;
  }
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

  sessionMetadata(sessionId: string) {
    const stream = 'workspace-a:meta';
    const flock = this.flocks.get(stream) ?? Flock.fromFile(this.snapshots.get(stream)!);
    return Object.fromEntries(
      Array.from(flock.scanValues())
        .filter((row) => row.key[0] === 'm' && row.key[1] === `session-${sessionId}`)
        .map((row) => [String(row.key[2]), row.value]),
    );
  }

  setSessionMetadata(
    sessionId: string,
    patch: Record<string, Parameters<InstanceType<typeof Flock>['set']>[1]>,
  ) {
    const stream = 'workspace-a:meta';
    const flock = this.flocks.get(stream) ?? Flock.fromFile(this.snapshots.get(stream)!);
    this.flocks.set(stream, flock);
    const version = flock.version();
    for (const [key, value] of Object.entries(patch))
      flock.set(['m', `session-${sessionId}`, key], value);
    flock.commit();
    this.snapshots.set(stream, flock.exportFile());
    this.record(stream, new TextEncoder().encode(JSON.stringify(flock.exportJson(version))));
  }

  readSchedule(scheduleId: string) {
    const stream = `workspace-a:schedule:${scheduleId}`;
    let doc = this.documents.get(stream);
    if (!doc) {
      doc = new LoroDoc();
      const snapshot = this.snapshots.get(stream);
      if (snapshot) doc.import(snapshot);
      this.documents.set(stream, doc);
    }
    return doc;
  }
  scheduleRegistryRows() {
    const stream = 'workspace-a:sr';
    const flock = this.flocks.get(stream) ?? Flock.fromFile(this.snapshots.get(stream)!);
    this.flocks.set(stream, flock);
    return Array.from(flock.scanValues());
  }
  failNextScheduleRegistryPublication() {
    this.rejectNextScheduleRegistry = true;
  }
  setScheduleRuntime(row: {
    scheduleId: string;
    machineId: string;
    activationId: string;
    observedDefinitionFingerprint: string;
    nextScheduledAt?: number;
    queueState?: 'due' | 'waiting_for_agent' | 'retrying' | 'blocked';
    blockedCode?: string;
    updatedAt: number;
    lastDispatch?: { scheduledFor: number; dispatchedAt: number; sessionId: string };
  }) {
    this.scheduleRegistryRows();
    const stream = 'workspace-a:sr';
    const flock = this.flocks.get(stream)!;
    const version = flock.version();
    flock.set(['runtime', row.scheduleId, row.machineId], row);
    flock.commit();
    this.snapshots.set(stream, flock.exportFile());
    this.record(stream, new TextEncoder().encode(JSON.stringify(flock.exportJson(version))));
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

  reply(sessionId: string, turnId = 'live-answer') {
    const turn = this.document(sessionId)
      .getList('history')
      .toArray()
      .find((item) => item instanceof LoroMap && item.get('id') === turnId);
    assert.ok(turn instanceof LoroMap);
    return turn;
  }

  finishReply(sessionId: string, status = 'handled') {
    this.changeSession(sessionId, () => {
      const turn = this.reply(sessionId);
      turn.set('finished', true);
      turn.set('acpTurnId', `provider-${String(turn.get('id'))}`);
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

  finishWorkHistory() {
    this.changeSession('history-a', (doc) => {
      const turn = doc.getList('history').get(1);
      assert.ok(turn instanceof LoroMap);
      turn.set('items', finalWorkItems);
      turn.set('finished', true);
    });
  }

  private accept(stream: string, body: Buffer) {
    for (let cursor = 0; cursor < body.length;) {
      const length = body.readUInt32BE(cursor);
      cursor += 4;
      assert.ok(cursor + length <= body.length, 'Complete Streams binary frame');
      const bytes = body.subarray(cursor, cursor + length);
      cursor += length;
      if (stream.startsWith('workspace-a:s:') || stream.startsWith('workspace-a:schedule:')) {
        const doc = stream.startsWith('workspace-a:s:')
          ? this.document(stream.slice('workspace-a:s:'.length))
          : this.readSchedule(stream.slice('workspace-a:schedule:'.length));
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
        if (stream === 'workspace-a:mf:machine-a') {
          for (const row of flock.scanValues()) {
            if (
              row.key[0] === 'cmd' &&
              row.key[1] === 'deleteSession' &&
              row.value !== undefined &&
              this.completeDeleteCommands
            ) {
              const key = v.parse(
                v.tuple([v.literal('cmd'), v.literal('deleteSession'), v.string()]),
                row.key,
              );
              const command = v.parse(
                v.strictObject({ v: v.literal(1), requestedAt: v.number() }),
                row.value,
              );
              const identity = `delete:${key[2]}:${command.requestedAt}`;
              if (!this.seenMachineCommands.has(identity)) {
                this.seenMachineCommands.add(identity);
                this.deleteRequests.push(key[2]);
                this.deleteSessionMetadata(key[2]);
              }
            }
            if (row.key[0] !== 'cmd' || row.key[1] !== 'archiveSession' || row.value === undefined)
              continue;
            const key = v.parse(
              v.tuple([v.literal('cmd'), v.literal('archiveSession'), v.string()]),
              row.key,
            );
            const command = v.parse(
              v.strictObject({
                v: v.literal(1),
                requestedAt: v.number(),
                requestedBy: v.literal('user-a'),
              }),
              row.value,
            );
            const identity = `${key[2]}:${command.requestedAt}`;
            if (this.seenMachineCommands.has(identity)) continue;
            this.seenMachineCommands.add(identity);
            this.archiveRequests.push({
              sessionId: key[2],
              requestedBy: command.requestedBy,
              requestedAt: command.requestedAt,
            });
            if (!this.deferArchiveCommands) this.setSessionMetadata(key[2], { isArchived: true });
          }
        }
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
      workHistory?: { finished: boolean; stopped?: boolean };
      defaultMcp?: boolean;
      agent?: {
        cliType: 'builtin' | 'registry' | 'custom';
        agentType: string;
        brandId?: string;
        prompt?: string;
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
    meta.set(['e', 'machine-machine-a'], true);
    meta.set(['m', 'machine-machine-a', 'id'], 'machine-a');
    meta.set(['m', 'machine-machine-a', 'name'], 'Controlled Mac');
    meta.set(['m', 'machine-machine-a', 'timeZone'], 'Asia/Singapore');
    meta.set(['m', 'machine-machine-a', 'protocolCapabilities'], { schedules: 1 });
    const workspace = new Flock();
    workspace.set(['mcpServer', 'research-stdio'], {
      id: 'research-stdio',
      name: 'Research tools',
      transport: 'stdio',
      description: 'Controlled workspace research',
      connection: { transport: 'stdio', command: 'research-mcp' },
      enabledByDefault: options.defaultMcp ?? false,
      createdAt: 1,
      updatedAt: 1,
    });
    workspace.set(['mcpServer', 'unconfigured-http'], {
      id: 'unconfigured-http',
      name: 'Unconfigured HTTP tools',
      transport: 'http',
      enabledByDefault: false,
      createdAt: 1,
      updatedAt: 1,
    });
    workspace.commit();
    this.snapshots.set('workspace-a:wf:workspace', workspace.exportFile());
    const schedules = new Flock();
    schedules.commit();
    this.snapshots.set('workspace-a:sr', schedules.exportFile());
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
      acknowledgedSteer: true,
      sessionFork: true,
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
            id: 'model',
            category: 'model',
            name: 'Model',
            type: 'select',
            currentValue: 'model-a',
            options: [{ value: 'model-a', name: 'Controlled model' }],
          },
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
            id: 'model',
            category: 'model',
            name: 'Model',
            type: 'select',
            currentValue: 'model-a',
            options: [
              { value: 'model-a', name: 'Model A' },
              { value: 'model-b', name: 'Model B' },
            ],
          },
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
    const capabilityRow = Array.from(machine.scanValues()).find(
      (row) => row.key[0] === 'acpCapability' && row.key[1] === 'agent-a',
    );
    const capability = v.parse(v.record(v.string(), v.unknown()), capabilityRow?.value);
    machine.set(
      ['acpCapability', 'agent-a'],
      JSON.parse(
        JSON.stringify({
          ...capability,
          acknowledgedSteer: true,
          sessionFork: true,
          availableCommands: [{ name: 'compact', description: '压缩当前上下文' }],
        }),
      ),
    );
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
    assistant.set('acpTurnId', 'provider-previous-assistant-turn');
    assistant.set('role', 'assistant');
    assistant.set('finished', true);
    assistant.set('timestamp', '2026-01-01T00:00:01.000Z');
    assistant.set('items', [
      {
        type: 'tool_call',
        toolCallId: 'read-history',
        kind: 'read',
        title: 'Read cloud history',
        status: 'completed',
        command: 'read README.md',
        output: 'Controlled tool output from cloud history',
      },
      { type: 'text', text: 'Answer restored from real Loro snapshot\n\n' },
      {
        type: 'text',
        text: '## Cloud history\n\n```typescript\nconst source = "controlled HTTP snapshot";\n```\n\n| Boundary | Evidence |\n| --- | --- |\n| History | Loro snapshot |\n\n<script>alert(1)</script> [unsafe](javascript:alert(1))',
      },
    ]);
    if (options.workHistory) {
      assistant.set(
        'items',
        options.workHistory.finished && !options.workHistory.stopped ? finalWorkItems : workItems,
      );
      assistant.set('finished', options.workHistory.finished);
      if (options.workHistory.stopped) assistant.set('status', 'canceled');
    }
    doc.commit();
    this.snapshots.set('workspace-a:s:history-a', doc.export({ mode: 'snapshot' }));
  }

  private machineCommand(
    method: string,
    params: Record<string, unknown>,
    requestId: string,
  ): Record<string, unknown> | null {
    if (new Set(['session/edit-and-resend', 'session/fork', 'session/steer']).has(method)) {
      const key = `${method}:${requestId}`;
      const previous = this.mutationInputs.get(key);
      if (previous)
        assert.deepEqual(params, previous, 'An uncertain mutation retains its request payload');
      else this.mutationInputs.set(key, structuredClone(params));
    }
    if (method === 'session/edit-and-resend') {
      const input = v.parse(
        v.strictObject({
          sessionId: v.string(),
          expectedUserTurnId: v.string(),
          replacementUserTurnId: v.string(),
          requestedByUserId: v.literal('user-a'),
          timestamp: v.string(),
          inputConfig: v.record(v.string(), v.unknown()),
        }),
        params,
      );
      assert.equal(
        requestId,
        input.replacementUserTurnId,
        'Edit RPC identity is the replacement turn identity',
      );
      this.editRequests.push({ requestId, ...structuredClone(input) });
      const response = {
        type: 'session/edit-and-resend_response',
        sessionId: input.sessionId,
        replacementUserTurnId: input.replacementUserTurnId,
      };
      if (input.expectedUserTurnId === input.replacementUserTurnId)
        return {
          ...response,
          success: false,
          error: {
            code: 'USER_TURN_NOT_EDITABLE',
            message: 'The replacement user turn must use a new id.',
          },
        };
      const history = v.parse(
        v.array(
          v.looseObject({
            id: v.string(),
            role: v.string(),
            userId: v.exactOptional(v.string()),
            status: v.exactOptional(v.string()),
            finished: v.exactOptional(v.boolean()),
            acpTurnId: v.exactOptional(v.string()),
            inputConfig: v.exactOptional(
              v.looseObject({ _lodyDeliveryKind: v.exactOptional(v.string()) }),
            ),
          }),
        ),
        this.document(input.sessionId).getList('history').toJSON(),
      );
      const lastUser = history.findLast((turn) => turn.role === 'user');
      if (lastUser?.id === input.replacementUserTurnId) return { ...response, success: true };
      if (lastUser?.id !== input.expectedUserTurnId)
        return {
          ...response,
          success: false,
          error: {
            code: 'STALE_USER_TURN',
            message: 'The last user message changed before the edit was applied.',
          },
        };
      // Mirrors shared/session-data/planner resolveEditableTail provider-boundary rules.
      const userIndex = history.findLastIndex((turn) => turn.role === 'user');
      const previous = history
        .slice(0, userIndex)
        .findLast((turn) => new Set(['user', 'assistant']).has(turn.role));
      const editable =
        !new Set(['pending_apply', 'delivery_unknown']).has(lastUser.status ?? '') &&
        lastUser.inputConfig?._lodyDeliveryKind !== 'steer' &&
        (!previous ||
          (previous.role === 'assistant' && previous.finished === true && !!previous.acpTurnId));
      if (!editable)
        return {
          ...response,
          success: false,
          error: {
            code: 'USER_TURN_NOT_EDITABLE',
            message: 'The last user message has no safe provider turn boundary.',
          },
        };
      const config = v.parse(
        v.looseObject({
          prompt: v.string(),
          inputBlocks: v.exactOptional(v.array(v.record(v.string(), v.unknown()))),
        }),
        input.inputConfig,
      );
      this.changeSession(input.sessionId, (doc) => {
        const targetHistory = doc.getList('history');
        targetHistory.delete(userIndex, targetHistory.length - userIndex);
        const replacement = targetHistory.insertContainer(targetHistory.length, new LoroMap());
        replacement.set('id', input.replacementUserTurnId);
        replacement.set('role', 'user');
        replacement.set('userId', lastUser.userId ?? input.requestedByUserId);
        replacement.set('timestamp', input.timestamp);
        replacement.set('status', 'pending');
        replacement.set('finished', true);
        replacement.set('inputConfig', JSON.parse(JSON.stringify(input.inputConfig)));
        replacement.set(
          'items',
          JSON.parse(JSON.stringify(config.inputBlocks ?? [{ type: 'text', text: config.prompt }])),
        );
      });
      this.setSessionMetadata(input.sessionId, { latestUserMsgId: input.replacementUserTurnId });
      return { ...response, success: true };
    }
    if (method === 'local-project/control') {
      const input = v.parse(
        v.strictObject({
          request: v.strictObject({
            type: v.literal('local-project/list-global-skills'),
            machineId: v.literal('machine-a'),
            workspaceId: v.literal('workspace-a'),
            requestedByUserId: v.exactOptional(v.literal('user-a')),
          }),
        }),
        params,
      );
      this.skillRequests.push(input.request);
      return {
        ok: true,
        type: input.request.type,
        result: {
          groups: [
            {
              scope: 'global',
              dir: '~/.agents/skills',
              truncated: false,
              skills: [
                {
                  id: 'page-research',
                  name: 'Page research',
                  description: 'Review the current page with sources',
                  relativePath: 'page-research/SKILL.md',
                  absolutePath: '/controlled/skills/page-research/SKILL.md',
                  isSymlink: false,
                },
              ],
            },
          ],
        },
      };
    }
    if (method === 'session/steer') {
      const input = v.parse(
        v.strictObject({
          sessionId: v.string(),
          expectedTurnId: v.string(),
          userTurnId: v.string(),
          userId: v.string(),
          timestamp: v.string(),
          inputConfig: v.record(v.string(), v.unknown()),
        }),
        params,
      );
      this.steerTransmissions.push(requestId);
      if (!this.steerRequests.some((request) => request.requestId === requestId))
        this.steerRequests.push({
          requestId,
          sessionId: input.sessionId,
          expectedTurnId: input.expectedTurnId,
          userTurnId: input.userTurnId,
        });
      const active = this.reply(input.sessionId, input.expectedTurnId);
      const applied = active.get('finished') === false;
      return {
        type: 'session/steer_response',
        sessionId: input.sessionId,
        userTurnId: input.userTurnId,
        applied,
        disposition: applied ? 'applied' : 'no-active-turn',
      };
    }
    if (method === 'session/fork') {
      const input = v.parse(
        v.strictObject({
          sourceSessionId: v.string(),
          sourceTurnId: v.string(),
          targetSessionId: v.string(),
          requestedByUserId: v.literal('user-a'),
          targetContext: v.exactOptional(v.strictObject({ kind: v.literal('shared') })),
        }),
        params,
      );
      this.forkRequests.push({
        requestId,
        sourceSessionId: input.sourceSessionId,
        sourceTurnId: input.sourceTurnId,
        targetSessionId: input.targetSessionId,
      });
      const stream = `workspace-a:s:${input.targetSessionId}`;
      if (!this.snapshots.has(stream)) {
        const source = this.document(input.sourceSessionId);
        const turns = v.parse(
          v.array(v.object({ id: v.string() })),
          source.getList('history').toJSON(),
        );
        const index = turns.findIndex((turn) => turn.id === input.sourceTurnId);
        assert.ok(index >= 0);
        const target = new LoroDoc();
        target.import(source.export({ mode: 'snapshot' }));
        const history = target.getList('history');
        if (index + 1 < history.length) history.delete(index + 1, history.length - index - 1);
        const queue = target.getMovableList('mq');
        if (queue.length) queue.delete(0, queue.length);
        target.commit();
        this.snapshots.set(stream, target.export({ mode: 'snapshot' }));
        const metaStream = 'workspace-a:meta';
        const meta = this.flocks.get(metaStream) ?? Flock.fromFile(this.snapshots.get(metaStream)!);
        const before = meta.version();
        const original = Array.from(meta.scanValues()).filter(
          (row) => row.key[0] === 'm' && row.key[1] === `session-${input.sourceSessionId}`,
        );
        meta.set(['e', `session-${input.targetSessionId}`], true);
        for (const row of original)
          meta.set(['m', `session-${input.targetSessionId}`, row.key[2]!], row.value);
        meta.set(['m', `session-${input.targetSessionId}`, 'createdAt'], new Date().toISOString());
        meta.commit();
        this.flocks.set(metaStream, meta);
        this.snapshots.set(metaStream, meta.exportFile());
        this.record(metaStream, new TextEncoder().encode(JSON.stringify(meta.exportJson(before))));
      }
      return {
        type: 'session/fork_response',
        sourceSessionId: input.sourceSessionId,
        targetSessionId: input.targetSessionId,
        success: true,
        disposition: 'completed',
        partial: false,
      };
    }
    return null;
  }

  async install(context: BrowserContext) {
    await context.route('https://api.lody.ai/**', async (route) => {
      const request = route.request();
      assert.equal(request.headers().authorization, `Bearer ${streamToken}`);
      const url = new URL(request.url());
      const stream = decodeURIComponent(url.pathname.split('/')[3]!);
      if (
        this.denyMachineWrites &&
        stream === 'workspace-a:mf:machine-a' &&
        request.method() === 'POST'
      ) {
        this.deniedMachineWrites.push(request.postData() ?? '');
        await route.fulfill({ status: 403, body: 'Controlled deletion command denial' });
        return;
      }
      if (
        this.rejectNextScheduleRegistry &&
        stream === 'workspace-a:sr' &&
        request.method() === 'POST'
      ) {
        this.rejectNextScheduleRegistry = false;
        this.unconfirmedStream = stream;
      }
      if (stream === this.unconfirmedStream) {
        await route.fulfill({ status: 403, body: 'Controlled lost write/read confirmation' });
        return;
      }
      if (this.denyCommandResponses && stream.includes(':rpc:res:') && request.method() === 'GET') {
        await route.fulfill({ status: 403, body: 'Controlled command response denial' });
        return;
      }
      if (url.pathname.endsWith('/bootstrap')) {
        await this.connectionGate;
        this.reads.push(stream);
        const bytes =
          this.snapshots.get(stream) ??
          (stream.startsWith('workspace-a:s:') || stream.startsWith('workspace-a:schedule:')
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
          const envelope = v.parse(
            v.object({
              jsonrpc: v.literal('2.0'),
              rpcVersion: v.literal('1'),
              id: v.string(),
              method: v.string(),
              replyTo: v.string(),
              params: v.record(v.string(), v.unknown()),
            }),
            JSON.parse(body.toString()),
          );
          const handled = this.machineCommand(envelope.method, envelope.params, envelope.id);
          if (handled) {
            if (envelope.method === 'session/steer' && this.loseNextSteerConfirmation) {
              this.loseNextSteerConfirmation = false;
              this.unconfirmedSteers.add(envelope.id);
            }
            if (envelope.method === 'session/steer' && this.unconfirmedSteers.has(envelope.id)) {
              await route.fulfill({
                status: 403,
                body: 'Steer accepted; response confirmation unavailable',
              });
              return;
            }
            if (envelope.method === 'session/edit-and-resend' && this.loseNextEditConfirmation) {
              this.loseNextEditConfirmation = false;
              await route.fulfill({
                status: 403,
                body: 'Edit applied; response confirmation unavailable',
              });
              return;
            }
            this.record(
              envelope.replyTo,
              Buffer.from(
                JSON.stringify([
                  { jsonrpc: '2.0', rpcVersion: '1', id: envelope.id, result: handled },
                ]),
              ),
            );
            await route.fulfill({
              status: 200,
              headers: {
                'stream-next-offset': String(this.offset(stream)),
                'access-control-expose-headers': 'Stream-Next-Offset',
              },
              body: '',
            });
            return;
          }
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
            const turn = this.reply(message.params.sessionId, message.params.turnId);
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
        } else {
          this.accept(stream, body);
          if (
            this.loseNextWriteConfirmation &&
            stream.startsWith('workspace-a:s:') &&
            this.document(stream.slice('workspace-a:s:'.length)).getList('history').length > 0
          ) {
            this.loseNextWriteConfirmation = false;
            this.unconfirmedStream = stream;
            await route.fulfill({
              status: 403,
              body: 'Write accepted but confirmation unavailable',
            });
            return;
          }
        }
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
    await this.sharing.install(context);
    await this.shortcuts.install(context);
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
