import { isExtension } from '../storage';
import { createCodeWorker as createExtensionCodeWorker } from './create-extension-code-worker';

export function createCodeWorker() {
  // A running dev server may retain its old alias config until it is restarted.
  if (isExtension()) return createExtensionCodeWorker();
  return new Worker(new URL('./markdown-highlight.worker.ts', import.meta.url), {
    type: 'module',
  });
}
