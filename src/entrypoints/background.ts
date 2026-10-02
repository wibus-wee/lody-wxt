import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import { parsePreferences } from '../features/preferences/model';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'preferences:get'
    ) {
      return browser.storage.local
        .get('preferences')
        .then((value) => parsePreferences(value.preferences));
    }
    return undefined;
  });
});
