import type { SendTurn, SessionMetadata, SessionRuntime } from '@lody-mobile/sdk';
import * as v from 'valibot';

export interface SessionAdmission {
  metadata: SessionMetadata;
  input: SendTurn;
  state: 'metadata-unconfirmed' | 'metadata-synced' | 'synced';
}

export class SessionAdmissionError extends Error {
  constructor(
    readonly admission: SessionAdmission,
    cause: Error,
  ) {
    super('session_admission_incomplete', { cause });
    this.name = 'SessionAdmissionError';
  }
}

export async function startSession(
  runtime: SessionRuntime,
  meta: SessionMetadata,
  input: SendTurn,
): Promise<SessionAdmission> {
  const admission: SessionAdmission = {
    metadata: {
      ...structuredClone(meta),
      cliType: meta.cliType ?? input.inputConfig.cliType,
      agentType: meta.agentType ?? input.inputConfig.agentType,
      status: meta.status ?? { type: 'idle' },
      historyBackend: meta.historyBackend ?? 'loro',
      lastMessageAt: meta.lastMessageAt ?? Date.parse(input.timestamp),
    },
    input: structuredClone(input),
    state: 'metadata-unconfirmed',
  };
  try {
    await runtime.createSession(admission.metadata);
    admission.state = 'metadata-synced';
    await runtime.send(admission.metadata.id, admission.input);
    admission.state = 'synced';
    return admission;
  } catch (error) {
    if (error instanceof Error) throw new SessionAdmissionError(admission, error);
    throw error;
  }
}

const steerVerdict = v.object({
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
});

export async function steerTurn(
  runtime: SessionRuntime,
  machineId: string,
  sessionId: string,
  expectedTurnId: string,
  input: SendTurn,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const handle = await runtime.openSession(sessionId);
  try {
    signal?.throwIfAborted();
    await handle.append(input, 'guide');
    await handle.flush();
    let result = v.parse(
      steerVerdict,
      await runtime.steer(machineId, sessionId, expectedTurnId, input, signal),
    );
    if (result.recoveryOwned && result.disposition === 'promotion-failed') {
      result = v.parse(
        steerVerdict,
        await runtime.steer(machineId, sessionId, expectedTurnId, input, signal),
      );
    }
    if (result.applied) return { ...result, state: 'applied' as const };
    if (
      !result.recoveryOwned &&
      ['no-active-turn', 'promotion-failed'].includes(result.disposition)
    ) {
      signal?.throwIfAborted();
      await handle.promote(input.requestId);
      return { ...result, state: 'queued' as const };
    }
    if (
      result.recoveryOwned &&
      ['no-active-turn', 'stale-turn', 'busy', 'unsupported'].includes(result.disposition)
    ) {
      await handle.flush();
      const turn = handle.read().history.find((turn) => turn.id === input.requestId);
      if (turn && ['pending', 'seen', 'processing', 'handled'].includes(turn.status ?? ''))
        return { ...result, state: 'recovered' as const };
    }
    throw new Error('steer_delivery_uncertain');
  } finally {
    await handle.close();
  }
}

export async function refreshMachineCapabilities(
  runtime: SessionRuntime,
  machineId: string,
  configId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<void> {
  const result = v.parse(
    v.object({ success: v.boolean(), error: v.exactOptional(v.string()) }),
    await runtime.refreshCapabilities(machineId, configId, requestId, signal),
  );
  if (!result.success) throw new Error(result.error ?? 'Capability refresh failed.');
}
