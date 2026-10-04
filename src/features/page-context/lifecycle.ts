import { browser } from 'wxt/browser';

import { openSidePanel } from './actions';

export function registerSidePanelLifecycle() {
  const configure = () => {
    if (!browser.sidePanel?.setPanelBehavior) return;
    // The built-in side-panel action skips activeTab grants; see README.md.
    void browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch((error: unknown) => {
        console.error('Could not enable the Lody toolbar side panel.', error);
      });
  };
  const toolbar = browser.action ?? browser.browserAction;
  toolbar?.onClicked.addListener((tab) => {
    if (tab.windowId !== undefined)
      void openSidePanel(tab.windowId).catch((error: unknown) => console.error(error));
  });
  browser.runtime.onInstalled.addListener(configure);
  browser.runtime.onStartup.addListener(configure);
}
