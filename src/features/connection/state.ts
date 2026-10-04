import * as v from 'valibot';
import { browser } from 'wxt/browser';

import { requestApiAccess } from '../page-context/actions';

const originSchema = v.pipe(
  v.string(),
  v.url(),
  v.check((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  }),
);
export interface OriginAccessPort {
  protocol: string;
  contains: (permissions: { origins: string[] }) => Promise<boolean>;
}
export async function requireApiAccess(
  origin: string,
  port: OriginAccessPort = {
    protocol: location.protocol,
    contains: (permissions) => browser.permissions.contains(permissions),
  },
) {
  const normalized = new URL(v.parse(originSchema, origin)).origin;
  if (!new Set(['chrome-extension:', 'moz-extension:']).has(port.protocol)) return;
  if (!(await port.contains({ origins: [`${normalized}/*`] })))
    throw new Error(`Browser host permission missing for ${normalized}.`);
}
export const grantGatewayAccess = (origin: string) =>
  requestApiAccess(new URL(v.parse(originSchema, origin)).origin);
export function workspaceScope(
  authOrigin: string,
  clientId: string,
  accountId: string,
  workspaceId: string,
) {
  return JSON.stringify([new URL(authOrigin).origin, clientId, accountId, workspaceId]);
}
