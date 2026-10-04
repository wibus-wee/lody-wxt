import type { RequestOptions } from '../../shared/application/request-options.js';
import type { SessionSubmission } from '../domain/submission.js';
import type { SessionSubmissionGateway } from './ports.js';

export class SessionSubmissionService {
  constructor(private readonly gateway: SessionSubmissionGateway) {}

  submit = (workspaceId: string, input: SessionSubmission, options?: RequestOptions) =>
    this.gateway.submit(workspaceId, input, options);

  lookup = (workspaceId: string, requestId: string, options?: RequestOptions) =>
    this.gateway.lookup(workspaceId, requestId, options);
}
