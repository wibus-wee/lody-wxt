import type { RequestOptions } from '../../shared/application/request-options.js';
import { bearerCredential } from '../../shared/domain/values.js';
import type { Workspace } from '../domain/models.js';
import type { WorkspaceRepository } from './ports.js';

export class WorkspaceService {
  constructor(private readonly repository: WorkspaceRepository) {}

  list = async (token: string, options: RequestOptions = {}): Promise<Workspace[]> =>
    this.repository.list(bearerCredential(token), options);
}
