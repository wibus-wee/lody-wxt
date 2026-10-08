import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { Plugin } from 'vite';

const requireSdk = createRequire(new URL('../../packages/lody-sdk/package.json', import.meta.url));
const flockRoot = path.dirname(path.dirname(requireSdk.resolve('@loro-dev/flock-wasm')));

export const sharedFlockWasmUrl = '/assets/flock_wasm_bg.wasm';
const flockWasmPath = path.join(flockRoot, 'bundler/flock_wasm_bg.wasm');

/** Emit Flock once at a stable extension URL shared by page and worker bundles. */
export function sharedFlockWasmAsset(): Plugin {
  let command: 'build' | 'serve' = 'build';
  return {
    name: 'lody-shared-flock-wasm',
    enforce: 'pre',
    configResolved(config) {
      command = config.command;
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url !== sharedFlockWasmUrl) return next();
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/wasm');
        response.end(await readFile(flockWasmPath));
      });
    },
    async buildStart() {
      if (command === 'serve') return;
      this.emitFile({
        type: 'asset',
        fileName: sharedFlockWasmUrl.slice(1),
        source: await readFile(flockWasmPath),
      });
    },
  };
}
