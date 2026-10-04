import type {
  Account,
  DeviceAuthorization,
  DeviceToken,
  LodyClient,
  Workspace,
} from '@lody-mobile/sdk';
import { createLodyClient, LodySdkError } from '@lody-mobile/sdk';
import * as v from 'valibot';

import { officialAccountConfig } from '../../app/product-config';
import type { AccountConfig, AccountErrorContext, StoredSession } from './model';
import { accountError, sameConfig, storedSessionSchema } from './model';
import type { AccountStorage, AccountStorageChange } from './storage';

export interface AccountState {
  status:
    | 'loading'
    | 'unconfigured'
    | 'signed_out'
    | 'requesting'
    | 'authorizing'
    | 'validating'
    | 'signed_in'
    | 'cancelled'
    | 'error';
  config: AccountConfig | null;
  client: LodyClient | null;
  authorization: DeviceAuthorization | null;
  token: DeviceToken | null;
  account: Account | null;
  workspaces: Workspace[];
  workspace: Workspace | null;
  expiresAtMs: number | null;
  error: string | null;
  errorContext?: AccountErrorContext | null;
  canRetryRestore?: boolean;
}

const initialState: AccountState = {
  status: 'loading',
  config: null,
  client: null,
  authorization: null,
  token: null,
  account: null,
  workspaces: [],
  workspace: null,
  expiresAtMs: null,
  error: null,
  errorContext: null,
};

export class AccountController {
  private state = initialState;
  private listeners = new Set<() => void>();
  private operation: AbortController | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private writes: Promise<void> = Promise.resolve();
  private generation = 0;
  private unwatch: (() => void) | undefined;
  private observedConfig: string | undefined;
  private observedSession: string | undefined;

  private changed = (change: AccountStorageChange) => {
    const value = JSON.stringify(change.value);
    if (change.key === 'config') {
      if (value === this.observedConfig) return;
      this.observedConfig = value;
    } else {
      if (value === this.observedSession) return;
      this.observedSession = value;
      const session = change.value;
      if (
        session &&
        this.state.status === 'signed_in' &&
        this.state.config &&
        sameConfig(session.config, this.state.config) &&
        session.token.access_token === this.state.token?.access_token &&
        session.expiresAtMs === this.state.expiresAtMs
      ) {
        this.publish({
          ...this.state,
          workspace: this.state.workspaces.find((row) => row.id === session.workspaceId) ?? null,
        });
        return;
      }
    }
    const operation = this.begin();
    if (change.key === 'config') this.publish({ ...initialState, status: 'loading' });
    else this.publish(this.cleared(this.state.config ? 'signed_out' : 'unconfigured'));
    if (change.key === 'session' && change.value === null) return;
    void this.restore(operation);
  };

  constructor(
    private readonly storage: AccountStorage,
    private readonly createClient: (config: AccountConfig) => LodyClient = createLodyClient,
  ) {}

  getSnapshot = (): AccountState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(state: AccountState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private begin() {
    this.generation += 1;
    this.operation?.abort();
    clearTimeout(this.expiryTimer);
    const operation = new AbortController();
    this.operation = operation;
    return operation;
  }

  private active(operation: AbortController) {
    return this.operation === operation && !operation.signal.aborted;
  }

  private persist(session: StoredSession | null, config?: AccountConfig | null) {
    const generation = this.generation;
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        if (generation !== this.generation) return;
        this.observedSession = JSON.stringify(session);
        await this.storage.saveSession(session);
        if (generation !== this.generation) return;
        if (config !== undefined) {
          this.observedConfig = JSON.stringify(config);
          await this.storage.saveConfig(config);
        }
      });
    return this.writes;
  }

  private cleared(status: AccountState['status'], error: string | null = null): AccountState {
    return { ...initialState, config: this.state.config, client: this.state.client, status, error };
  }

  initialize = async (): Promise<void> => {
    this.unwatch?.();
    this.unwatch = this.storage.watch(this.changed);
    this.publish({ ...initialState });
    await this.restore(this.begin());
  };

  retryValidation = async (): Promise<void> => {
    this.publish({ ...this.cleared('loading'), canRetryRestore: false });
    await this.restore(this.begin());
  };

  private async restore(operation: AbortController): Promise<void> {
    try {
      const [storedConfig, session] = await Promise.all([
        this.storage.loadConfig(),
        this.storage.loadSession(),
      ]);
      if (!this.active(operation)) return;
      this.observedConfig = JSON.stringify(storedConfig);
      this.observedSession = JSON.stringify(session);
      const config = officialAccountConfig;
      const migrated = !storedConfig || !sameConfig(config, storedConfig);
      if (migrated) {
        await this.persist(null, config);
        if (!this.active(operation)) return;
      }
      const client = this.createClient(config);
      this.publish({ ...initialState, status: 'signed_out', config, client });
      if (
        !migrated &&
        session &&
        sameConfig(config, session.config) &&
        session.expiresAtMs > Date.now()
      ) {
        await this.validate(client, config, session.token, operation, session);
      } else if (!migrated) await this.persist(null);
    } catch (error) {
      await this.fail(operation, accountError(error));
    }
  }

  login = async (): Promise<void> => {
    const operation = this.begin();
    const { config, client } = this.state;
    if (!config || !client) {
      this.publish(this.cleared('unconfigured', 'configuration_required'));
      return;
    }
    this.publish(this.cleared('requesting'));
    let context: AccountErrorContext = { phase: 'storage', operation: 'storage' };
    try {
      await this.persist(null);
      if (!this.active(operation)) return;
      context = { phase: 'requesting', operation: 'device_code' };
      const authorization = await client.identity.requestDeviceCode({ signal: operation.signal });
      if (!this.active(operation)) return;
      this.publish({ ...this.state, status: 'authorizing', authorization });
      context = { phase: 'authorizing', operation: 'device_token' };
      const token = await client.identity.waitForDeviceToken(authorization, {
        signal: operation.signal,
      });
      if (!this.active(operation)) return;
      await this.validate(client, config, token, operation);
    } catch (error) {
      await this.fail(operation, accountError(error), context);
    }
  };

  private async validate(
    client: LodyClient,
    config: AccountConfig,
    token: DeviceToken,
    operation: AbortController,
    restored?: StoredSession,
  ) {
    this.publish({
      ...this.state,
      status: 'validating',
      authorization: null,
      token: restored?.token ?? null,
      expiresAtMs: restored?.expiresAtMs ?? null,
      error: null,
      errorContext: null,
      canRetryRestore: false,
    });
    const receivedAt = Date.now();
    let context: AccountErrorContext = { phase: 'validating', operation: 'session' };
    try {
      const [account, workspaces] = await Promise.all([
        client.identity
          .getAccount(token.access_token, { signal: operation.signal })
          .catch(async (error) => {
            await this.fail(operation, accountError(error), {
              phase: 'validating',
              operation: 'account',
            });
            throw error;
          }),
        client.workspaces
          .list(token.access_token, { signal: operation.signal })
          .catch(async (error) => {
            await this.fail(operation, accountError(error), {
              phase: 'validating',
              operation: 'workspaces',
            });
            throw error;
          }),
      ]);
      if (!this.active(operation)) return;
      const expiresAtMs = Math.min(
        Date.parse(account.session.expiresAt),
        restored?.expiresAtMs ??
          (token.expires_in === undefined ? Infinity : receivedAt + token.expires_in * 1000),
      );
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now())
        throw new LodySdkError('expired_token');
      const workspace = workspaces.find((row) => row.id === restored?.workspaceId) ?? null;
      const session = v.parse(storedSessionSchema, {
        config,
        token,
        expiresAtMs,
        workspaceId: workspace?.id ?? null,
      });
      context = { phase: 'storage', operation: 'storage' };
      if (
        !restored ||
        restored.expiresAtMs !== session.expiresAtMs ||
        restored.workspaceId !== session.workspaceId
      )
        await this.persist(session);
      if (!this.active(operation)) return;
      this.publish({
        ...this.state,
        status: 'signed_in',
        token: session.token,
        account,
        workspaces,
        workspace,
        expiresAtMs,
        error: null,
        errorContext: null,
      });
      this.armExpiry(operation, expiresAtMs);
    } catch (error) {
      await this.fail(operation, accountError(error), context);
    }
  }

  private armExpiry(operation: AbortController, expiresAtMs: number) {
    this.expiryTimer = setTimeout(
      () => {
        if (!this.active(operation)) return;
        if (Date.now() < expiresAtMs) this.armExpiry(operation, expiresAtMs);
        else {
          this.begin();
          this.publish(this.cleared('error', 'expired_token'));
          void this.persist(null).catch(() => this.publish(this.cleared('error', 'storage_error')));
        }
      },
      Math.min(Math.max(0, expiresAtMs - Date.now()), 2_147_483_647),
    );
  }

  private async fail(
    operation: AbortController,
    error: string,
    errorContext: AccountErrorContext | null = null,
  ) {
    if (!this.active(operation)) return;
    operation.abort();
    const invalid = new Set(['unauthenticated', 'expired_token', 'invalid_grant']).has(error);
    const retained = !invalid && this.state.token !== null;
    this.publish({
      ...this.cleared('error', error),
      token: retained ? this.state.token : null,
      expiresAtMs: retained ? this.state.expiresAtMs : null,
      canRetryRestore: retained || error === 'storage_error',
      errorContext,
    });
    try {
      if (invalid) await this.persist(null);
    } catch {
      if (this.operation !== operation) return;
      this.publish({
        ...this.cleared('error', 'storage_error'),
        errorContext: { phase: 'storage', operation: 'storage' },
      });
    }
  }

  selectWorkspace = async (id: string): Promise<void> => {
    const { config, token, expiresAtMs, workspaces } = this.state;
    if (!config || !token || !expiresAtMs || expiresAtMs <= Date.now()) return;
    const workspace = workspaces.find((row) => row.id === id);
    if (!workspace) return;
    const operation = this.operation;
    this.publish({ ...this.state, workspace });
    try {
      await this.persist(
        v.parse(storedSessionSchema, { config, token, expiresAtMs, workspaceId: id }),
      );
    } catch (error) {
      if (operation) await this.fail(operation, accountError(error));
    }
  };

  cancel = async (): Promise<void> => {
    this.begin();
    this.publish(this.cleared('cancelled', 'cancelled'));
    try {
      await this.persist(null);
    } catch {
      this.publish(this.cleared('error', 'storage_error'));
    }
  };

  logout = async (): Promise<void> => {
    this.begin();
    this.publish(this.cleared(this.state.config ? 'signed_out' : 'unconfigured'));
    try {
      await this.persist(null);
    } catch {
      this.publish(this.cleared('error', 'storage_error'));
    }
  };

  dispose = (): void => {
    this.begin();
    this.operation?.abort();
    this.unwatch?.();
    this.unwatch = undefined;
  };
}
