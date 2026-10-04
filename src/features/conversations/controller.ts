import type { RequestOptions, SessionSubmission, SubmissionReceipt } from '@lody-mobile/sdk';
import { HttpSessionSubmissionGateway, SessionSubmissionService } from '@lody-mobile/sdk';
import * as v from 'valibot';

import type { ConversationDraft, SendJournal } from './model';
import { draftSchema, receiptSchema } from './model';
import type { JournalStorage } from './storage';

export interface ConversationIdentity {
  authOrigin: string;
  clientId: string;
  accountId: string;
  sessionId: string;
  workspaceId: string;
  token: string;
  convexSiteUrl: string;
}
export interface SubmissionApi {
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
export interface ConversationState {
  ready: boolean;
  busy: boolean;
  journal: SendJournal | null;
  error: string | null;
}

export class ConversationsController {
  private state: ConversationState = { ready: false, busy: false, journal: null, error: null };
  private listeners = new Set<() => void>();
  private identity: ConversationIdentity | null = null;
  private operation: AbortController | null = null;
  private generation = 0;
  private key = '';
  private scope = '';

  constructor(
    private readonly storage: JournalStorage,
    private readonly createApi: (identity: ConversationIdentity) => SubmissionApi = (identity) =>
      new SessionSubmissionService(
        new HttpSessionSubmissionGateway({
          convexSiteUrl: identity.convexSiteUrl,
          auth: { getToken: async () => identity.token },
        }),
      ),
  ) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(state: ConversationState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  bind = async (identity: ConversationIdentity | null) => {
    this.operation?.abort();
    const generation = ++this.generation;
    this.identity = identity;
    this.scope = identity
      ? JSON.stringify([
          identity.authOrigin,
          identity.clientId,
          identity.accountId,
          identity.sessionId,
          identity.workspaceId,
        ])
      : '';
    this.key = identity
      ? `lody:conversation:${JSON.stringify([this.scope, identity.convexSiteUrl])}`
      : '';
    this.publish({ ready: false, busy: false, journal: null, error: null });
    if (!identity) return;
    try {
      const journal = await this.storage.load(this.key);
      if (generation !== this.generation) return;
      if (journal && (journal.scope !== this.scope || journal.key !== this.key))
        throw new Error('Submission identity or receipt does not match.');
      this.publish({ ready: true, busy: false, journal, error: null });
    } catch {
      if (generation === this.generation)
        this.publish({
          ready: false,
          busy: false,
          journal: null,
          error: 'Journal could not be read. Sending is blocked.',
        });
    }
  };

  send = async (draft: ConversationDraft) => {
    if (!this.identity || !this.state.ready || this.state.busy || this.state.journal) return;
    const generation = this.generation;
    const identity = this.identity;
    const operation = new AbortController();
    this.operation = operation;
    this.publish({ ...this.state, busy: true, error: null });
    let claimed = false;
    try {
      const input = v.parse(draftSchema, draft);
      if (input.convexSiteUrl !== identity.convexSiteUrl)
        throw new Error('Submission identity or receipt does not match.');
      const journal: SendJournal = {
        key: this.key,
        scope: this.scope,
        requestId: crypto.randomUUID(),
        createdAt: Date.now(),
        state: 'unconfirmed',
        receipt: null,
      };
      claimed = await this.storage.claim(journal);
      if (generation !== this.generation) return;
      if (!claimed) {
        const existing = await this.storage.load(journal.key);
        if (generation === this.generation)
          this.publish({
            ...this.state,
            busy: false,
            ready: false,
            journal: existing,
            error: 'A submission already exists. Query its request ID; do not resend.',
          });
        return;
      }
      this.publish({ ...this.state, journal });
      if (operation.signal.aborted) return;
      const api = this.createApi(identity);
      const receipt = v.parse(
        receiptSchema,
        await api.submit(
          identity.workspaceId,
          {
            requestId: journal.requestId,
            machineId: input.machineId,
            agentConfigId: input.agentConfigId,
            ...(input.localProjectId
              ? {
                  project: {
                    kind: 'local' as const,
                    localProjectId: input.localProjectId,
                    ...(input.branch ? { branch: input.branch } : {}),
                  },
                }
              : {}),
            title: input.title,
            prompt: input.prompt,
            ...(input.modelId ? { modelId: input.modelId } : {}),
            cliType: input.cliType,
            agentType: input.agentType,
          },
          { signal: operation.signal },
        ),
      );
      await this.accept(receipt, journal, generation, operation);
    } catch {
      if (generation === this.generation && !operation.signal.aborted)
        this.publish({
          ...this.state,
          busy: false,
          error: claimed
            ? 'Delivery is unconfirmed. Query the same request ID before taking further action.'
            : 'Configuration or journal write failed. No request was sent.',
        });
    }
  };

  private async accept(
    receipt: SubmissionReceipt,
    journal: SendJournal,
    generation: number,
    operation: AbortController,
  ) {
    if (generation !== this.generation || operation.signal.aborted) return;
    if (receipt.requestId !== journal.requestId || receipt.turnId !== journal.requestId)
      throw new Error('Submission identity or receipt does not match.');
    const next: SendJournal = {
      ...journal,
      state: receipt.state === 'unconfirmed' ? 'unconfirmed' : 'accepted',
      receipt,
    };
    await this.storage.save(next);
    if (generation !== this.generation || operation.signal.aborted) return;
    this.publish({ ready: true, busy: false, journal: next, error: null });
  }

  recover = async () => {
    const { journal, busy } = this.state;
    if (!journal || !this.identity || busy) return;
    const generation = this.generation;
    const identity = this.identity;
    const operation = new AbortController();
    this.operation = operation;
    this.publish({ ...this.state, busy: true, error: null });
    try {
      const receipt = await this.createApi(identity).lookup(
        identity.workspaceId,
        journal.requestId,
        { signal: operation.signal },
      );
      if (generation !== this.generation || operation.signal.aborted) return;
      if (receipt)
        await this.accept(v.parse(receiptSchema, receipt), journal, generation, operation);
      else
        this.publish({
          ...this.state,
          busy: false,
          error: 'No receipt is available yet. Delivery remains unconfirmed; no automatic resend.',
        });
    } catch {
      if (generation === this.generation && !operation.signal.aborted)
        this.publish({
          ...this.state,
          busy: false,
          error: 'Receipt lookup failed. Keep this request ID and query again.',
        });
    }
  };

  newConversation = async () => {
    if (this.state.busy || this.state.journal?.state !== 'accepted') return;
    const generation = this.generation;
    this.publish({ ...this.state, busy: true });
    try {
      await this.storage.clear(this.key);
      if (generation === this.generation)
        this.publish({ ready: true, busy: false, journal: null, error: null });
    } catch {
      if (generation === this.generation)
        this.publish({ ...this.state, busy: false, error: 'Journal could not be cleared.' });
    }
  };

  cancel = () => {
    this.operation?.abort();
    this.publish({
      ...this.state,
      busy: false,
      error:
        'Local waiting stopped. This does not cancel server execution. Query the request ID to confirm delivery.',
    });
  };
  dispose = () => {
    ++this.generation;
    this.operation?.abort();
  };
}
