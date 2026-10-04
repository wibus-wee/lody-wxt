import * as v from 'valibot';

import type { RequestOptions } from '../../shared/application/request-options.js';
import type { HttpClient } from '../../shared/infrastructure/http/http-client.js';
import {
  authDateString,
  nonemptyString,
  parseResponse,
} from '../../shared/infrastructure/http/schemas.js';
import type { WorkspaceRepository } from '../application/ports.js';
import type { Workspace } from '../domain/models.js';

const workspaceListSchema = v.array(
  v.looseObject({
    id: nonemptyString,
    name: nonemptyString,
    slug: nonemptyString,
    logo: v.exactOptional(v.nullable(v.string())),
    createdAt: v.exactOptional(authDateString),
    metadata: v.exactOptional(v.unknown()),
  }),
);

export class HttpWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly http: HttpClient) {}

  async list(credential: string, options: RequestOptions): Promise<Workspace[]> {
    const { data } = await this.http.request(
      '/api/auth/organization/list',
      undefined,
      credential,
      options,
    );
    return parseResponse(workspaceListSchema, data);
  }
}
