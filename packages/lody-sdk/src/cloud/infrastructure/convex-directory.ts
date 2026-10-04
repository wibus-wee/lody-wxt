import * as v from 'valibot';

import type { RequestOptions } from '../../shared/application/request-options.js';
import type { CloudDirectory, ConvexJwtProvider } from '../application/ports.js';
import { CloudError } from '../domain/models.js';

const machineFields = {
  machineId: v.string(),
  ownerUserId: v.string(),
  sharedWithTeam: v.boolean(),
  updatedAt: v.number(),
};
const machinesSchema = v.array(v.object(machineFields));
const projectsSchema = v.array(v.object({ ...machineFields, localProjectId: v.string() }));
const envelopeSchema = v.variant('status', [
  v.object({ status: v.literal('success'), value: v.unknown() }),
  v.object({
    status: v.literal('error'),
    errorMessage: v.string(),
    errorData: v.optional(v.unknown()),
  }),
]);
const jwtSchema = v.pipe(v.string(), v.regex(/^[\w-]+\.[\w-]+\.[\w-]+$/));

export interface ConvexDirectoryOptions {
  convexUrl: string;
  jwt: ConvexJwtProvider;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class ConvexCloudDirectory implements CloudDirectory {
  private readonly origin: string;
  constructor(private readonly options: ConvexDirectoryOptions) {
    const url = new URL(options.convexUrl);
    if (
      url.protocol !== 'https:' ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new CloudError('invalid_configuration', 0);
    this.origin = url.origin;
  }

  listMachines = async (workspaceId: string, options?: RequestOptions) =>
    v.parse(
      machinesSchema,
      await this.query('machines:listVisibleMachines', { workspaceId }, options),
    );

  listLocalProjects = async (workspaceId: string, options?: RequestOptions) =>
    v.parse(
      projectsSchema,
      await this.query('localProjects:listVisibleLocalProjects', { workspaceId }, options),
    );

  private async query(
    path: string,
    args: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs ?? 15_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new CloudError('invalid_configuration', 0);
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    signal.throwIfAborted();
    const jwt = v.parse(jwtSchema, await this.options.jwt.getJwt(signal));
    signal.throwIfAborted();
    const response = await (this.options.fetch ?? globalThis.fetch)(`${this.origin}/api/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, args, format: 'json' }),
      credentials: 'omit',
      cache: 'no-store',
      signal,
    });
    if (!response.ok) throw new CloudError('query_failed', response.status);
    const result = v.parse(envelopeSchema, await response.json());
    signal.throwIfAborted();
    if (result.status === 'error') throw new CloudError(result.errorMessage, response.status);
    return result.value;
  }
}
