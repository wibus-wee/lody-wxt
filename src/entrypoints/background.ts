import { defineBackground } from 'wxt/utils/define-background';

import { registerBrowserLifecycle } from '../features/connection/background';

export default defineBackground(() => {
  registerBrowserLifecycle();
});
