import { BetterAuthConvexJwtProvider, ConvexCloudDirectory } from '@lody-mobile/sdk';
import { expect, it } from 'vitest';

import { productConfig } from '../../src/app/product-config';
import { createWorkerFetch } from '../../src/features/connection/worker-fetch';

it('routes real JWT exchange and Convex query through JSON transport', async () => {
  const requests: Array<{
    url: string;
    method: string;
    credentials: string;
    redirect: string;
    body?: string;
  }> = [];
  const fetch = createWorkerFetch(async (url, request) => {
    requests.push({
      url,
      method: request.method,
      credentials: request.credentials,
      redirect: request.redirect,
      ...(request.body ? { body: request.body } : {}),
    });
    return {
      status: 200,
      json: async () =>
        url.endsWith('/api/auth/convex/token')
          ? { token: 'a.b.c' }
          : {
              status: 'success',
              value: [
                { machineId: 'machine', ownerUserId: 'user', sharedWithTeam: false, updatedAt: 1 },
              ],
            },
    };
  });
  const jwt = new BetterAuthConvexJwtProvider({
    authOrigin: productConfig.authOrigin,
    getSessionBearer: async () => 'bearer',
    fetch,
  });
  const directory = new ConvexCloudDirectory({ convexUrl: productConfig.convexOrigin, jwt, fetch });
  expect(await directory.listMachines('workspace')).toHaveLength(1);
  expect(requests.map((request) => request.url)).toEqual([
    'https://backend.lody.ai/api/auth/convex/token',
    'https://convex.lody.ai/api/query',
  ]);
  expect(
    requests.every((request) => request.credentials === 'omit' && request.redirect === 'error'),
  ).toBe(true);
  expect(JSON.parse(requests[1]!.body!)).toEqual({
    path: 'machines:listVisibleMachines',
    args: { workspaceId: 'workspace' },
    format: 'json',
  });
});
it('honors abort before dispatch and keeps HTTP errors visible', async () => {
  let calls = 0;
  const fetch = createWorkerFetch(async () => {
    calls++;
    return { status: 403, json: async () => ({ error: 'denied' }) };
  });
  const controller = new AbortController();
  controller.abort();
  await expect(
    fetch('https://backend.lody.ai/api/auth/convex/token', {
      credentials: 'omit',
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  const response = await fetch('https://backend.lody.ai/api/auth/convex/token', {
    credentials: 'omit',
  });
  expect(response.ok).toBe(false);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'denied' });
});
