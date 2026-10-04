import type { HttpTransport } from '@lody-mobile/sdk';
import { createLodyClient, LodySdkError } from '@lody-mobile/sdk';
import { afterEach, expect, it } from 'vitest';

import { AccountController } from '../../src/features/account/controller';
import { createAccountStorage } from '../../src/features/account/storage';

const config = { authOrigin: 'https://backend.lody.ai', clientId: 'lody-cli' };
const controllers: AccountController[] = [];
const expiresAt = () => new Date(Date.now() + 60_000).toISOString();

function setup(transport: HttpTransport, requestTimeoutMs = 15_000) {
  const storage = createAccountStorage();
  const controller = new AccountController(storage, (options) =>
    createLodyClient({
      ...options,
      transport,
      requestTimeoutMs,
    }),
  );
  controllers.push(controller);
  return { controller, storage };
}

const successfulTransport: HttpTransport = async (url, request) => {
  expect(new URL(url).origin).toBe(config.authOrigin);
  if (url.endsWith('/device/code'))
    expect(JSON.parse(request.body!).client_id).toBe(config.clientId);
  if (url.endsWith('/device/code'))
    return {
      status: 200,
      json: async () => ({
        device_code: 'private-code',
        user_code: 'ABCD',
        verification_uri: 'https://auth.example.test/device',
        verification_uri_complete: 'https://auth.example.test/device?code=ABCD',
        expires_in: 60,
        interval: 1,
      }),
    };
  if (url.endsWith('/device/token'))
    return { status: 200, json: async () => ({ access_token: 'credential', expires_in: 60 }) };
  expect(request.headers.Authorization).toBe('Bearer credential');
  if (url.endsWith('/get-session'))
    return {
      status: 200,
      json: async () => ({
        user: { id: 'user-1', email: 'person@example.test' },
        session: { id: 'session-1', userId: 'user-1', expiresAt: expiresAt() },
      }),
    };
  return {
    status: 200,
    json: async () => [{ id: 'workspace-1', name: 'Personal', slug: 'personal' }],
  };
};

afterEach(() => {
  for (const controller of controllers) controller.dispose();
  controllers.length = 0;
  localStorage.removeItem('lody:account:config');
  localStorage.removeItem('lody:account:session');
  sessionStorage.removeItem('lody:account:session');
});

it('runs the SDK device flow, verifies account and lists workspaces, restores selection, and signs out', async () => {
  const { controller } = setup(successfulTransport);
  await controller.initialize();
  expect(controller.getSnapshot().status).toBe('signed_out');
  expect(controller.getSnapshot().config).toEqual(config);
  await controller.login();
  expect(controller.getSnapshot().account?.user.id).toBe('user-1');
  expect(controller.getSnapshot().workspace).toBeNull();
  await controller.selectWorkspace('workspace-1');
  const restored = setup(successfulTransport).controller;
  await restored.initialize();
  expect(restored.getSnapshot().workspace?.id).toBe('workspace-1');
  await restored.logout();
  expect(restored.getSnapshot().token).toBeNull();
  expect(localStorage.getItem('lody:account:session')).toBeNull();
  expect(localStorage.getItem('lody:account:config')).not.toBeNull();
});

it('rejects malformed storage and explicit non-HTTPS configuration', async () => {
  const { controller, storage } = setup(successfulTransport);
  localStorage.setItem('lody:account:config', JSON.stringify({ ...config, extra: true }));
  localStorage.setItem('lody:account:session', '{broken');
  expect(await storage.loadConfig()).toBeNull();
  expect(await storage.loadSession()).toBeNull();
  await controller.initialize();
  expect(controller.getSnapshot().config).toEqual(config);
  expect(controller.getSnapshot().status).toBe('signed_out');
  expect(await storage.loadSession()).toBeNull();
});

it('does not restore credentials belonging to another configuration or an expired session', async () => {
  const { controller, storage } = setup(successfulTransport);
  await storage.saveConfig(config);
  await storage.saveSession({
    config: { ...config, clientId: 'old' },
    token: { access_token: 'old-token' },
    expiresAtMs: Date.now() + 60_000,
    workspaceId: null,
  });
  await controller.initialize();
  expect(controller.getSnapshot().status).toBe('signed_out');
  expect(await storage.loadSession()).toBeNull();
  await storage.saveSession({
    config,
    token: { access_token: 'old-token' },
    expiresAtMs: Date.now() - 1,
    workspaceId: null,
  });
  await controller.initialize();
  expect(controller.getSnapshot().token).toBeNull();
  expect(await storage.loadSession()).toBeNull();
});

it('cancels a pending real SDK request and a later identity change cannot restore it', async () => {
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  const { controller } = setup(async (_url, request) => {
    started();
    await new Promise<void>((_resolve, reject) =>
      request.signal.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      ),
    );
    return { status: 200, json: async () => null };
  });
  await controller.initialize();
  const pending = controller.login();
  await requested;
  await controller.cancel();
  await controller.initialize();
  await pending;
  expect(controller.getSnapshot().config).toEqual(config);
  expect(controller.getSnapshot().status).toBe('signed_out');
  expect(controller.getSnapshot().token).toBeNull();
});

it.each(['access_denied', 'expired_token', 'invalid_client'])(
  'exposes SDK %s without retaining credentials',
  async (code) => {
    const { controller, storage } = setup(async () => ({
      status: 400,
      json: async () => ({ error: code }),
    }));
    await controller.initialize();
    await controller.login();
    expect(controller.getSnapshot().error).toBe(code);
    expect(await storage.loadSession()).toBeNull();
  },
);

it('rejects an account session already expired on the server', async () => {
  const { controller, storage } = setup(async (url, request) => {
    if (url.endsWith('/get-session'))
      return {
        status: 200,
        json: async () => ({
          user: { id: 'user-1', email: 'person@example.test' },
          session: {
            id: 'session-1',
            userId: 'user-1',
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          },
        }),
      };
    return successfulTransport(url, request);
  });
  await controller.initialize();
  await controller.login();
  expect(controller.getSnapshot().error).toBe('expired_token');
  expect(controller.getSnapshot().account).toBeNull();
  expect(await storage.loadSession()).toBeNull();
});

it('reports the SDK request deadline and clears timed-out credentials', async () => {
  const { controller, storage } = setup(async (_url, request) => {
    await new Promise<void>((_resolve, reject) =>
      request.signal.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      ),
    );
    return { status: 200, json: async () => null };
  }, 20);
  await controller.initialize();
  await controller.login();
  expect(controller.getSnapshot().error).toBe('timeout');
  expect(await storage.loadSession()).toBeNull();
});

it('migrates a custom configuration without sending its credentials to the official server', async () => {
  let requests = 0;
  const { controller, storage } = setup(async (url, request) => {
    requests += 1;
    return successfulTransport(url, request);
  });
  const custom = { authOrigin: 'https://custom.example.test', clientId: 'custom' };
  await storage.saveConfig(custom);
  await storage.saveSession({
    config: custom,
    token: { access_token: 'custom-token' },
    expiresAtMs: Date.now() + 60_000,
    workspaceId: 'custom-workspace',
  });
  await controller.initialize();
  expect(controller.getSnapshot().status).toBe('signed_out');
  expect(controller.getSnapshot().config).toEqual(config);
  expect(controller.getSnapshot().account).toBeNull();
  expect(controller.getSnapshot().workspace).toBeNull();
  expect(await storage.loadConfig()).toEqual(config);
  expect(await storage.loadSession()).toBeNull();
  expect(requests).toBe(0);
});

function sessionChanged(value: string | null) {
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'lody:account:session',
      newValue: value,
      storageArea: localStorage,
    }),
  );
}

it('syncs external credentials, workspace and logout without starting a device flow or validation loop', async () => {
  let validations = 0;
  let deviceRequests = 0;
  const { controller, storage } = setup(async (url, request) => {
    if (url.includes('/device/')) deviceRequests += 1;
    else validations += 1;
    return successfulTransport(url, request);
  });
  await storage.saveConfig(config);
  await controller.initialize();
  await storage.saveSession({
    config,
    token: { access_token: 'credential' },
    expiresAtMs: Date.now() + 60_000,
    workspaceId: null,
  });
  const value = localStorage.getItem('lody:account:session');
  sessionChanged(value);
  expect(controller.getSnapshot().account).toBeNull();
  await expect.poll(() => controller.getSnapshot().status).toBe('signed_in');
  expect(validations).toBe(2);
  sessionChanged(value);
  await storage.saveSession({ ...JSON.parse(value!), workspaceId: 'workspace-1' });
  sessionChanged(localStorage.getItem('lody:account:session'));
  expect(controller.getSnapshot().workspace?.id).toBe('workspace-1');
  expect(validations).toBe(2);
  expect(deviceRequests).toBe(0);
  await storage.saveSession(null);
  sessionChanged(null);
  expect(controller.getSnapshot().status).toBe('signed_out');
  expect(controller.getSnapshot().account).toBeNull();
  expect(controller.getSnapshot().workspaces).toEqual([]);
  expect(controller.getSnapshot().token).toBeNull();
});

it('fences an external logout against pending validation and reinitializes after disposal', async () => {
  let release!: () => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { controller, storage } = setup(async (url, request) => {
    if (url.endsWith('/get-session')) {
      started();
      await gate;
    }
    return successfulTransport(url, request);
  });
  await storage.saveConfig(config);
  await controller.initialize();
  await storage.saveSession({
    config,
    token: { access_token: 'credential' },
    expiresAtMs: Date.now() + 60_000,
    workspaceId: null,
  });
  sessionChanged(localStorage.getItem('lody:account:session'));
  await requested;
  await storage.saveSession(null);
  sessionChanged(null);
  expect(controller.getSnapshot().status).toBe('signed_out');
  release();
  controller.dispose();
  await controller.initialize();
  expect(controller.getSnapshot().status).toBe('signed_out');
  expect(await storage.loadSession()).toBeNull();
  await storage.saveSession({
    config,
    token: { access_token: 'credential' },
    expiresAtMs: Date.now() + 60_000,
    workspaceId: 'workspace-1',
  });
  sessionChanged(localStorage.getItem('lody:account:session'));
  await expect.poll(() => controller.getSnapshot().workspace?.id).toBe('workspace-1');
  expect(controller.getSnapshot().account?.user.id).toBe('user-1');
});

it('propagates writes to three surfaces while ignoring local storage echoes', async () => {
  const backing = createAccountStorage();
  const listeners = new Set<
    Parameters<import('../../src/features/account/storage').AccountStorage['watch']>[0]
  >();
  let reads = 0;
  const storage: import('../../src/features/account/storage').AccountStorage = {
    loadConfig: backing.loadConfig,
    loadSession: backing.loadSession,
    async saveConfig(value) {
      await backing.saveConfig(value);
      for (const listener of listeners) listener({ key: 'config', value });
    },
    async saveSession(value) {
      await backing.saveSession(value);
      for (const listener of listeners) listener({ key: 'session', value });
    },
    watch(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const surfaces = Array.from({ length: 3 }, () => {
    const controller = new AccountController(storage, (options) =>
      createLodyClient({
        ...options,
        transport: async (url, request) => {
          if (!url.includes('/device/')) reads += 1;
          return successfulTransport(url, request);
        },
      }),
    );
    controllers.push(controller);
    return controller;
  });
  for (const surface of surfaces) await surface.initialize();
  await expect
    .poll(() => surfaces.every((surface) => surface.getSnapshot().status === 'signed_out'))
    .toBe(true);
  await surfaces[0]!.login();
  await expect
    .poll(() => surfaces.every((surface) => surface.getSnapshot().status === 'signed_in'))
    .toBe(true);
  expect(reads).toBe(6);
  await surfaces[0]!.selectWorkspace('workspace-1');
  expect(surfaces.every((surface) => surface.getSnapshot().workspace?.id === 'workspace-1')).toBe(
    true,
  );
  expect(reads).toBe(6);
  await surfaces[1]!.logout();
  expect(surfaces.every((surface) => surface.getSnapshot().account === null)).toBe(true);
  expect(await storage.loadSession()).toBeNull();
  surfaces[2]!.dispose();
  expect(listeners.size).toBe(2);
  await surfaces[2]!.initialize();
  expect(listeners.size).toBe(3);
});

it('fences a pending login when external custom configuration replaces the official identity', async () => {
  let release!: () => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { controller, storage } = setup(async (url, request) => {
    if (url.endsWith('/device/code')) {
      started();
      await gate;
    }
    return successfulTransport(url, request);
  });
  await controller.initialize();
  const pending = controller.login();
  await requested;
  const replacement = { authOrigin: 'https://custom.example.test', clientId: 'replacement' };
  await storage.saveConfig(replacement);
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'lody:account:config',
      newValue: JSON.stringify(replacement),
      storageArea: localStorage,
    }),
  );
  expect(controller.getSnapshot().account).toBeNull();
  expect(controller.getSnapshot().client).toBeNull();
  release();
  await pending;
  await expect.poll(() => controller.getSnapshot().status).toBe('signed_out');
  expect(controller.getSnapshot().config).toEqual(config);
  expect(await storage.loadConfig()).toEqual(config);
  expect(await storage.loadSession()).toBeNull();
});

it.each(['account', 'workspaces'] as const)(
  'retains the failing %s stage when the other concurrent response arrives later',
  async (failedOperation) => {
    let release!: () => void;
    let fail!: () => void;
    let started!: () => void;
    let returned!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failure = new Promise<void>((resolve) => {
      fail = resolve;
    });
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    const lateReturn = new Promise<void>((resolve) => {
      returned = resolve;
    });
    let validations = 0;
    const { controller, storage } = setup(async (url, request) => {
      if (url.includes('/device/')) return successfulTransport(url, request);
      validations += 1;
      if (validations === 2) started();
      const operation = url.endsWith('/get-session') ? 'account' : 'workspaces';
      if (operation === failedOperation) {
        await failure;
        return { status: 200, json: async () => ({ malformed: true }) };
      }
      await gate;
      const response = await successfulTransport(url, request);
      returned();
      return response;
    });
    await controller.initialize();
    const pending = controller.login();
    await requested;
    expect(controller.getSnapshot().status).toBe('validating');
    fail();
    await pending;
    const snapshot = controller.getSnapshot();
    expect(snapshot.error).toBe('invalid_response');
    expect(snapshot.errorContext).toEqual({ phase: 'validating', operation: failedOperation });
    expect(snapshot.account).toBeNull();
    expect(snapshot.token).toBeNull();
    expect(snapshot.workspaces).toEqual([]);
    expect(await storage.loadSession()).toBeNull();
    await controller.initialize();
    const replacement = controller.getSnapshot();
    expect(replacement.status).toBe('signed_out');
    expect(replacement.errorContext).toBeNull();
    release();
    await lateReturn;
    expect(controller.getSnapshot()).toBe(replacement);
  },
);

it.each(['device_code', 'device_token'] as const)(
  'reports the %s device flow stage without response details',
  async (operation) => {
    const { controller } = setup(async (url, request) => {
      if (url.endsWith(operation === 'device_code' ? '/device/code' : '/device/token'))
        return { status: 200, json: async () => ({ private: 'credential' }) };
      return successfulTransport(url, request);
    });
    await controller.initialize();
    await controller.login();
    expect(controller.getSnapshot().error).toBe('invalid_response');
    expect(controller.getSnapshot().errorContext).toEqual({
      phase: operation === 'device_code' ? 'requesting' : 'authorizing',
      operation,
    });
  },
);

it('migrates legacy session credentials into durable storage and removes the legacy copy', async () => {
  const storage = createAccountStorage();
  const session = {
    config,
    token: { access_token: 'credential' },
    expiresAtMs: Date.now() + 60_000,
    workspaceId: 'workspace-1',
  };
  sessionStorage.setItem('lody:account:session', JSON.stringify(session));
  expect(await storage.loadSession()).toEqual(session);
  expect(sessionStorage.getItem('lody:account:session')).toBeNull();
  expect(JSON.parse(localStorage.getItem('lody:account:session')!)).toEqual(session);
  await storage.saveSession(null);
  expect(await storage.loadSession()).toBeNull();
});

it.each(['timeout', 'invalid_response', 'network_error', 'forbidden'])(
  'preserves restored credentials after %s and retries validation without device authorization',
  async (code) => {
    let failing = true;
    let deviceRequests = 0;
    const { controller, storage } = setup(async (url, request) => {
      if (url.includes('/device/')) deviceRequests += 1;
      if (failing)
        throw new LodySdkError(
          code as 'timeout' | 'invalid_response' | 'network_error' | 'forbidden',
        );
      return successfulTransport(url, request);
    });
    await storage.saveConfig(config);
    const session = {
      config,
      token: { access_token: 'credential' },
      expiresAtMs: Date.now() + 60_000,
      workspaceId: 'workspace-1',
    };
    await storage.saveSession(session);
    await controller.initialize();
    expect(controller.getSnapshot().status).toBe('error');
    expect(controller.getSnapshot().canRetryRestore).toBe(true);
    expect(await storage.loadSession()).toEqual(session);
    failing = false;
    await controller.retryValidation();
    expect(controller.getSnapshot().status).toBe('signed_in');
    expect(controller.getSnapshot().workspace?.id).toBe('workspace-1');
    expect(deviceRequests).toBe(0);
  },
);

it('reports storage I/O failures without clearing a durable credential', async () => {
  const { controller, storage } = setup(successfulTransport);
  await storage.saveConfig(config);
  const session = {
    config,
    token: { access_token: 'credential' },
    expiresAtMs: Date.now() + 60_000,
    workspaceId: null,
  };
  await storage.saveSession(session);
  const failed = new AccountController({
    ...storage,
    loadConfig: async () => {
      throw new (await import('../../src/features/account/storage')).AccountStorageError(
        new Error('denied'),
      );
    },
  });
  controllers.push(failed);
  await failed.initialize();
  expect(failed.getSnapshot().error).toBe('storage_error');
  expect(await storage.loadSession()).toEqual(session);
  await controller.initialize();
  expect(controller.getSnapshot().status).toBe('signed_in');
});
