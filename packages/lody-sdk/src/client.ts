import { IdentityService } from './identity/application/identity-service.js';
import { HttpIdentityGateway } from './identity/infrastructure/http-identity-gateway.js';
import type { Clock } from './shared/application/clock.js';
import { LodySdkError } from './shared/domain/errors.js';
import { httpsUrl, milliseconds, nonempty } from './shared/domain/values.js';
import { createHttpClient } from './shared/infrastructure/http/http-client.js';
import type { HttpTransport } from './shared/infrastructure/http/transport.js';
import { systemClock } from './shared/infrastructure/system-clock.js';
import { StreamsService } from './streams/application/streams-service.js';
import { HttpStreamsGrantGateway } from './streams/infrastructure/http-streams-grant-gateway.js';
import { WorkspaceService } from './workspaces/application/workspace-service.js';
import { HttpWorkspaceRepository } from './workspaces/infrastructure/http-workspace-repository.js';

export interface ClientOptions {
  authOrigin: string;
  /** Required explicitly. The upstream CLI currently uses lody-cli. */
  clientId: string;
  transport?: HttpTransport;
  clock?: Clock;
  /** Positive milliseconds; defaults to 15,000 and includes JSON decoding. */
  requestTimeoutMs?: number;
}

/** Composition root: selects adapters and wires them into transport-independent use cases. */
export function createLodyClient(options: ClientOptions) {
  let origin: string;
  try {
    const url = new URL(options.authOrigin);
    if (!httpsUrl(options.authOrigin, true) || url.pathname !== '/')
      throw new Error('invalid_configuration');
    origin = url.origin;
  } catch {
    throw new LodySdkError('invalid_configuration');
  }
  if (!nonempty(options.clientId)) throw new LodySdkError('invalid_configuration');
  const clock = options.clock ?? systemClock;
  const requestTimeoutMs = milliseconds(
    options.requestTimeoutMs ?? 15_000,
    'invalid_configuration',
  );
  const http = createHttpClient({
    origin,
    clock,
    requestTimeoutMs,
    ...(options.transport === undefined ? {} : { transport: options.transport }),
  });
  const identity = new IdentityService(
    new HttpIdentityGateway(http, options.clientId),
    clock,
    requestTimeoutMs,
  );
  const workspaces = new WorkspaceService(new HttpWorkspaceRepository(http));
  const streams = new StreamsService(new HttpStreamsGrantGateway(http));

  return {
    identity,
    workspaces,
    streams,
    requestDeviceCode: identity.requestDeviceCode,
    requestDeviceToken: identity.requestDeviceToken,
    waitForDeviceToken: identity.waitForDeviceToken,
    getAccount: identity.getAccount,
    listWorkspaces: workspaces.list,
    getStreamsGrant: streams.getGrant,
  };
}

export type LodyClient = ReturnType<typeof createLodyClient>;
