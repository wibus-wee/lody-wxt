import type { RequestOptions } from '../../shared/application/request-options.js';
import type { Workspace } from '../domain/models.js';

export interface WorkspaceRepository {
  list: (credential: string, options: RequestOptions) => Promise<Workspace[]>;
}
