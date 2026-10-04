import type { RequestOptions } from '../../shared/application/request-options.js';
import type { StreamsGrant } from '../domain/models.js';

export type GrantOptions = RequestOptions & { rejectedToken?: string };

export interface StreamsGrantGateway {
  getGrant: (
    credential: string,
    workspaceId: string,
    options: GrantOptions,
  ) => Promise<StreamsGrant>;
}
