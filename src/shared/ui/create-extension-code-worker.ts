import { browser } from 'wxt/browser';

export function createCodeWorker() {
  // Vite's development origin is not valid for an extension's dedicated worker.
  return new Worker(browser.runtime.getURL('/markdown-highlight.js'), { type: 'module' });
}
