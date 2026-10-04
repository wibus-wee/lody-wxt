import { useEffect, useState } from 'react';

import { productConfig } from '../../app/product-config';
import { useAccount } from '../account/useAccount';
import { RealLodyClient } from './real-client';
import { workspaceScope } from './state';

export function useLodyClient(convexOrigin?: string, active = true): RealLodyClient | null {
  const account = useAccount();
  const accountId = account.account?.user.id;
  const sessionId = account.account?.session.id;
  const workspaceId = account.workspace?.id;
  const authOrigin = productConfig.authOrigin;
  const token = account.token?.access_token;
  const sdk = account.client;
  const signedIn = account.status === 'signed_in';
  const scope =
    accountId && workspaceId
      ? workspaceScope(authOrigin, productConfig.clientId, accountId, workspaceId)
      : '';
  const origin = convexOrigin ?? productConfig.convexOrigin;
  const key = JSON.stringify([scope, sessionId, token, origin]);
  const [current, setCurrent] = useState<{ key: string; client: RealLodyClient } | null>(null);
  const enabled = active || current?.key === key;
  useEffect(() => {
    if (!enabled) return;
    if (!signedIn || !accountId || !workspaceId || !authOrigin || !token || !sdk) return;
    if (!origin) return;
    const client = new RealLodyClient({
      accountKey: JSON.stringify([scope, new URL(origin).origin]),
      accountId,
      workspaceId,
      authOrigin,
      token,
      client: sdk,
      convexUrl: origin,
    });
    let active = true;
    queueMicrotask(() => {
      if (active) setCurrent({ key, client });
    });
    void client.connect().catch(() => {});
    return () => {
      active = false;
      void client.close();
    };
  }, [enabled, signedIn, accountId, workspaceId, authOrigin, token, sdk, scope, key, origin]);
  return signedIn && current?.key === key ? current.client : null;
}
