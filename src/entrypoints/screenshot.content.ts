import '../app/global.css';

import { defineContentScript } from 'wxt/utils/define-content-script';

import { registerScreenshotOverlay } from '../features/page-context/screenshot-overlay';

export default defineContentScript({
  registration: 'runtime',
  cssInjectionMode: 'manual',
  noScriptStartedPostMessage: true,
  main: registerScreenshotOverlay,
});
