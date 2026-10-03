import { browser } from 'wxt/browser';

import type { DemoRequest } from '../chat/demo-runtime';
import { DemoRuntime } from '../chat/demo-runtime';
import { parsePreferences } from '../preferences/model';

export function registerBrowserLifecycle() {
  const runtime = new DemoRuntime();
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/')))
      return undefined;
    if (!message || typeof message !== 'object' || !('type' in message)) return undefined;
    if (message.type === 'preferences:get')
      return browser.storage.local
        .get('preferences')
        .then((value) => parsePreferences(value.preferences));
    if (message.type === 'lody:demo') {
      return runtime.request(message as DemoRequest).then(
        (data) => ({ data }),
        (error: unknown) => ({
          error: error instanceof Error ? error.message : '演示操作失败；检查存储空间并重试。',
        }),
      );
    }
    return undefined;
  });
  browser.runtime.onInstalled.addListener(() => {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  });
}
