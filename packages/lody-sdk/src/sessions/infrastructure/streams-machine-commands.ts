import * as v from 'valibot';

import type { MachineCommandPort } from '../application/runtime-ports.js';
import { binaryProgressSchema, refreshResultSchema } from './machine-protocol.js';
import { skillRequestSchema, skillResultSchema } from './skills-protocol.js';

export type RpcPayload = Record<string, unknown>;
type RpcListener = (message: RpcPayload) => void;
export type RpcFailure = (error: Error) => void;
export interface JsonRpcStreamsPort {
  ensure: (streamId: string) => Promise<void>;
  append: (streamId: string, value: RpcPayload) => Promise<void>;
  subscribe: (
    streamId: string,
    listener: RpcListener,
    signal: AbortSignal,
    onError?: RpcFailure,
  ) => Promise<void>;
}
const responseSchema = v.variant('jsonrpc', [
  v.looseObject({
    jsonrpc: v.literal('2.0'),
    id: v.string(),
    rpcVersion: v.literal('1'),
    result: v.exactOptional(v.unknown()),
    error: v.exactOptional(
      v.object({ code: v.string(), message: v.string(), data: v.exactOptional(v.unknown()) }),
    ),
  }),
]);
const idSchema = v.pipe(v.string(), v.minLength(1));
const paramsSchemas = {
  'local-project/control': v.strictObject({ request: skillRequestSchema }),
  'session/cancel': v.strictObject({
    sessionId: idSchema,
    turnId: idSchema,
    subagentTaskId: v.exactOptional(idSchema),
  }),
  'session/steer': v.strictObject({
    sessionId: idSchema,
    expectedTurnId: idSchema,
    userTurnId: idSchema,
    userId: idSchema,
    timestamp: idSchema,
    inputConfig: v.record(v.string(), v.unknown()),
  }),
  'session/dispatch-turn': v.strictObject({
    sessionId: idSchema,
    userTurnId: idSchema,
    userId: idSchema,
    timestamp: idSchema,
    inputConfig: v.record(v.string(), v.unknown()),
  }),
  'machine/status': v.strictObject({}),
  'machine/acp-capabilities-refresh': v.strictObject({
    configId: idSchema,
    force: v.exactOptional(v.boolean()),
  }),
  'session/edit-and-resend': v.strictObject({
    sessionId: idSchema,
    expectedUserTurnId: idSchema,
    replacementUserTurnId: idSchema,
    requestedByUserId: idSchema,
    timestamp: idSchema,
    inputConfig: v.record(v.string(), v.unknown()),
  }),
  'session/fork': v.strictObject({
    sourceSessionId: idSchema,
    sourceTurnId: idSchema,
    targetSessionId: idSchema,
    requestedByUserId: idSchema,
    targetContext: v.exactOptional(
      v.variant('kind', [
        v.strictObject({ kind: v.literal('shared') }),
        v.strictObject({
          kind: v.literal('new-worktree'),
          acknowledgeDirtySource: v.exactOptional(v.literal(true)),
        }),
      ]),
    ),
    targetPlacement: v.exactOptional(v.literal('side-panel')),
  }),
};
const methodSchema = v.picklist(Object.keys(paramsSchemas) as Array<keyof typeof paramsSchemas>);
const failure = v.exactOptional(v.looseObject({ code: idSchema, message: idSchema }));
const resultSchemas = {
  'local-project/control': skillResultSchema,
  'session/cancel': v.looseObject({
    type: v.literal('session/cancel_response'),
    sessionId: idSchema,
    success: v.boolean(),
    error: v.exactOptional(v.string()),
  }),
  'session/steer': v.looseObject({
    type: v.literal('session/steer_response'),
    sessionId: idSchema,
    userTurnId: idSchema,
    applied: v.boolean(),
    recoveryOwned: v.exactOptional(v.boolean()),
    disposition: v.picklist([
      'applied',
      'unsupported',
      'no-active-turn',
      'stale-turn',
      'busy',
      'delivery-unknown',
      'promotion-failed',
      'error',
    ]),
    error: v.exactOptional(v.string()),
  }),
  'session/dispatch-turn': v.looseObject({
    type: v.literal('session/dispatch-turn_response'),
    sessionId: idSchema,
    userTurnId: idSchema,
    accepted: v.boolean(),
    disposition: idSchema,
  }),
  'session/edit-and-resend': v.looseObject({
    type: v.literal('session/edit-and-resend_response'),
    sessionId: idSchema,
    replacementUserTurnId: idSchema,
    success: v.boolean(),
    error: failure,
  }),
  'session/fork': v.looseObject({
    type: v.literal('session/fork_response'),
    sourceSessionId: idSchema,
    targetSessionId: idSchema,
    success: v.boolean(),
    disposition: v.exactOptional(
      v.picklist(['accepted', 'confirmation-required', 'completed', 'failed']),
    ),
    error: failure,
  }),
  'machine/status': v.record(v.string(), v.unknown()),
  'machine/acp-capabilities-refresh': refreshResultSchema,
};

const responseIdentities = {
  'local-project/control': [],
  'session/cancel': ['sessionId'],
  'session/steer': ['sessionId', 'userTurnId'],
  'session/dispatch-turn': ['sessionId', 'userTurnId'],
  'session/edit-and-resend': ['sessionId', 'replacementUserTurnId'],
  'session/fork': ['sourceSessionId', 'targetSessionId'],
  'machine/status': [],
  'machine/acp-capabilities-refresh': ['configId'],
} satisfies Record<keyof typeof paramsSchemas, string[]>;

export class StreamsMachineCommands implements MachineCommandPort {
  constructor(
    private readonly options: {
      workspaceId: string;
      streams: JsonRpcStreamsPort;
      timeoutMs?: number;
      now?: () => number;
    },
  ) {
    v.parse(idSchema, options.workspaceId);
  }

  request = async (
    machineId: string,
    method: string,
    params: Record<string, unknown>,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    v.parse(idSchema, machineId);
    v.parse(idSchema, requestId);
    const validMethod = v.parse(methodSchema, method);
    const validParams: Record<string, unknown> = v.parse(paramsSchemas[validMethod], params);
    if (validMethod === 'local-project/control') {
      const request = v.parse(skillRequestSchema, validParams.request);
      if (request.machineId !== machineId || request.workspaceId !== this.options.workspaceId)
        throw new Error('request_identity_mismatch');
    }
    const timeoutMs = this.options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('invalid_configuration');
    const controller = new AbortController();
    const deadline = new AbortController();
    const expire = () =>
      deadline.abort(new DOMException('Machine command timed out', 'TimeoutError'));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const renew = () => {
      clearTimeout(timer);
      timer = setTimeout(expire, timeoutMs);
    };
    const combined = AbortSignal.any([
      controller.signal,
      deadline.signal,
      ...(signal ? [signal] : []),
    ]);
    combined.throwIfAborted();
    const replyTo = `${this.options.workspaceId}:rpc:res:${machineId}`;
    const requestStream = `${this.options.workspaceId}:rpc:req:${machineId}`;
    await this.options.streams.ensure(replyTo);
    await this.options.streams.ensure(requestStream);
    const now = (this.options.now ?? Date.now)();
    let resolveResponse: RpcListener = () => {};
    // Promise rejection preserves protocol, validation and abort failures from this boundary.
    // ast-grep-ignore: no-unknown-parameter
    let rejectResponse: (error: unknown) => void = () => {};
    const response = new Promise<unknown>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    void response.catch(() => {});
    const aborted = () => rejectResponse(combined.reason);
    combined.addEventListener('abort', aborted, { once: true });
    try {
      renew();
      combined.throwIfAborted();
      await this.options.streams.subscribe(
        replyTo,
        (value) => {
          try {
            const parsed = v.parse(responseSchema, value);
            if (parsed.id !== requestId) return;
            if (parsed.error) rejectResponse(new Error(parsed.error.code));
            else if (Object.hasOwn(parsed, 'result')) {
              if (validMethod === 'machine/acp-capabilities-refresh') {
                const payload = v.parse(v.record(v.string(), v.unknown()), parsed.result);
                if (payload.type === 'machine/acp-binary-progress') {
                  const progress = v.parse(binaryProgressSchema, payload);
                  if (progress.machineId !== machineId)
                    throw new Error('response_identity_mismatch');
                  renew();
                  return;
                }
              }
              const result: Record<string, unknown> = v.parse(
                resultSchemas[validMethod],
                parsed.result,
              );
              if (
                validMethod === 'machine/acp-capabilities-refresh' &&
                result.machineId !== machineId
              )
                throw new Error('response_identity_mismatch');
              if (
                validMethod === 'local-project/control' &&
                result.type !== v.parse(skillRequestSchema, validParams.request).type
              )
                throw new Error('response_identity_mismatch');
              if (responseIdentities[validMethod].some((key) => result[key] !== validParams[key]))
                throw new Error('response_identity_mismatch');
              resolveResponse(result);
            } else rejectResponse(new Error('invalid_response'));
          } catch (error) {
            rejectResponse(error);
          }
        },
        combined,
        rejectResponse,
      );
      await this.options.streams.append(requestStream, {
        jsonrpc: '2.0',
        id: requestId,
        method: validMethod,
        rpcVersion: '1',
        machineId,
        workspaceId: this.options.workspaceId,
        replyTo,
        sentAt: now,
        expiresAt: now + timeoutMs,
        params: validParams,
      });
      return await response;
    } finally {
      clearTimeout(timer);
      combined.removeEventListener('abort', aborted);
      controller.abort();
    }
  };
}
