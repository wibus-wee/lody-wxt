import * as v from 'valibot';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import { registerAccountStorageLifecycle } from '../features/account/storage';
import { registerWorkspaceConnectionLifecycle } from '../features/connection/background-lifecycle';
import { createNetworkHandler } from '../features/network/background';
import { registerNotificationLifecycle } from '../features/notifications/lifecycle';
import { registerPageContextEntrypoints } from '../features/page-context/intents';
import { registerSidePanelLifecycle } from '../features/page-context/lifecycle';
import { parsePreferences } from '../features/preferences/model';
import { registerUpdateLifecycle } from '../features/updates/lifecycle';

export default defineBackground(() => {
  registerAccountStorageLifecycle();
  registerWorkspaceConnectionLifecycle();
  registerSidePanelLifecycle();
  registerPageContextEntrypoints();
  registerNotificationLifecycle();
  registerUpdateLifecycle();
  browser.runtime.onMessage.addListener(createNetworkHandler());
  browser.runtime.onMessage.addListener((message: unknown) => {
    const request = v.safeParse(v.object({ type: v.literal('preferences:get') }), message);
    if (request.success) {
      return browser.storage.local
        .get('preferences')
        .then((value) => parsePreferences(value.preferences));
    }
    return undefined;
  });
});
