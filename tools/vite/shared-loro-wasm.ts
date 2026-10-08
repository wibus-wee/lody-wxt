import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { Plugin } from 'vite';

const requireSdk = createRequire(new URL('../../packages/lody-sdk/package.json', import.meta.url));
const loroRoot = path.dirname(requireSdk.resolve('loro-crdt/package.json'));

export const sharedLoroWasmUrl = '/assets/loro_wasm_bg.wasm';
const loroWasmPath = path.join(loroRoot, 'web/loro_wasm_bg.wasm');

/** Emit Loro's web build once so the page and service worker share the same binary. */
export function sharedLoroWasmAsset(): Plugin {
  let command: 'build' | 'serve' = 'build';
  return {
    name: 'lody-shared-loro-wasm',
    enforce: 'pre',
    configResolved(config) {
      command = config.command;
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url !== sharedLoroWasmUrl) return next();
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/wasm');
        response.end(await readFile(loroWasmPath));
      });
    },
    async buildStart() {
      if (command === 'serve') return;
      this.emitFile({
        type: 'asset',
        fileName: sharedLoroWasmUrl.slice(1),
        source: await readFile(loroWasmPath),
      });
    },
  };
}
