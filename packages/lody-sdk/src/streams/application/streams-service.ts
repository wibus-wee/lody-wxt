import { bearerCredential } from '../../shared/domain/values.js';
import { workspaceId } from '../../workspaces/domain/workspace-id.js';
import { rejectedGrantToken } from '../domain/grant-request.js';
import type { StreamsGrant } from '../domain/models.js';
import type { GrantOptions, StreamsGrantGateway } from './ports.js';

export class StreamsService {
  constructor(private readonly gateway: StreamsGrantGateway) {}

  /** Each invocation requests one grant; credential storage and grant caching belong to callers. */
  getGrant = async (
    token: string,
    id: string,
    options: GrantOptions = {},
  ): Promise<StreamsGrant> => {
    const normalizedId = workspaceId(id);
    rejectedGrantToken(options.rejectedToken);
    return this.gateway.getGrant(bearerCredential(token), normalizedId, options);
  };
}
