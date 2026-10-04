import * as v from 'valibot';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import { registerAccountStorageLifecycle } from '../features/account/storage';
import { createNetworkHandler } from '../features/network/background';
import { registerSidePanelLifecycle } from '../features/page-context/lifecycle';
import { parsePreferences } from '../features/preferences/model';

export default defineBackground(() => {
  registerAccountStorageLifecycle();
  registerSidePanelLifecycle();
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
