import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { Plugin } from 'vite';

const requireSdk = createRequire(new URL('../../packages/lody-sdk/package.json', import.meta.url));
const flockRoot = path.dirname(path.dirname(requireSdk.resolve('@loro-dev/flock-wasm')));

export const sharedFlockWasmUrl = '/assets/flock_wasm_bg.wasm';

/** Emit Flock once at a stable extension URL shared by page and worker bundles. */
export function sharedFlockWasmAsset(): Plugin {
  return {
    name: 'lody-shared-flock-wasm',
    enforce: 'pre',
    async buildStart() {
      this.emitFile({
        type: 'asset',
        fileName: sharedFlockWasmUrl.slice(1),
        source: await readFile(path.join(flockRoot, 'bundler/flock_wasm_bg.wasm')),
      });
    },
  };
}
