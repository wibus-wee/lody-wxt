import { browser } from 'wxt/browser';

const httpsOrigin = /^https:\/\/[^/?#@]+\/?$/;

export async function openSidePanel(
  windowId: number = browser.windows.WINDOW_ID_CURRENT,
): Promise<void> {
  if (!browser.sidePanel?.open) {
    await browser.runtime.openOptionsPage();
    throw new Error(
      '此浏览器未提供 Lody 所需的侧栏 API，已打开设置页面。快捷侧栏目前支持桌面 Chrome。',
    );
  }
  await browser.sidePanel.open({ windowId });
}

export interface ApiAccessPort {
  protocol: string;
  request: (permissions: { origins: string[] }) => Promise<boolean>;
}

class ApiAccessError extends Error {
  constructor(readonly code: 'invalid_configuration' | 'browser_access_declined') {
    super(
      code === 'invalid_configuration'
        ? 'Enter an HTTPS origin without a path or credentials.'
        : 'Browser access to the API was declined.',
    );
  }
}

export async function requestApiAccess(
  origin: string,
  port: ApiAccessPort = {
    protocol: location.protocol,
    request: (permissions) => browser.permissions.request(permissions),
  },
): Promise<void> {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new ApiAccessError('invalid_configuration');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !httpsOrigin.test(origin))
    throw new ApiAccessError('invalid_configuration');
  if (!new Set(['chrome-extension:', 'moz-extension:']).has(port.protocol)) return;
  const granted = await port.request({ origins: [`${url.origin}/*`] });
  if (!granted) throw new ApiAccessError('browser_access_declined');
}
