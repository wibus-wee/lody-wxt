import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { Plugin } from 'vite';

const requireSdk = createRequire(new URL('../../packages/lody-sdk/package.json', import.meta.url));
const loroRoot = path.dirname(requireSdk.resolve('loro-crdt/package.json'));

export const sharedLoroWasmUrl = '/assets/loro_wasm_bg.wasm';

/** Emit Loro's web build once so the page and service worker share the same binary. */
export function sharedLoroWasmAsset(): Plugin {
  return {
    name: 'lody-shared-loro-wasm',
    enforce: 'pre',
    async buildStart() {
      this.emitFile({
        type: 'asset',
        fileName: sharedLoroWasmUrl.slice(1),
        source: await readFile(path.join(loroRoot, 'web/loro_wasm_bg.wasm')),
      });
    },
  };
}
