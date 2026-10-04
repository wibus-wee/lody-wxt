import { browser } from 'wxt/browser';

export function registerSidePanelLifecycle() {
  const configure = () => {
    void browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => {
        console.error('Could not enable the Lody toolbar side panel.', error);
      });
  };
  browser.runtime.onInstalled.addListener(configure);
  browser.runtime.onStartup.addListener(configure);
}
