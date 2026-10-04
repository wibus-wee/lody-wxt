import type { RequestOptions } from '../../shared/application/request-options.js';
import type { SessionSubmission, SubmissionReceipt } from '../domain/submission.js';

export interface SessionSubmissionGateway {
  submit: (
    workspaceId: string,
    input: SessionSubmission,
    options?: RequestOptions,
  ) => Promise<SubmissionReceipt>;
  lookup: (
    workspaceId: string,
    requestId: string,
    options?: RequestOptions,
  ) => Promise<SubmissionReceipt | null>;
}

export interface AuthTokenProvider {
  getToken: (signal?: AbortSignal) => Promise<string>;
}
