import type { RequestOptions } from '../../shared/application/request-options.js';
import type { VisibleLocalProject, VisibleMachine } from '../domain/models.js';

export interface ConvexJwtProvider {
  getJwt: (signal?: AbortSignal) => Promise<string>;
}

export interface CloudDirectory {
  listMachines: (workspaceId: string, options?: RequestOptions) => Promise<VisibleMachine[]>;
  listLocalProjects: (
    workspaceId: string,
    options?: RequestOptions,
  ) => Promise<VisibleLocalProject[]>;
}
