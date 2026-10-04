import { createRequire } from 'node:module';
import path from 'node:path';

import type { Plugin } from 'vite';

const requireSdk = createRequire(new URL('../../packages/lody-sdk/package.json', import.meta.url));
const virtualId = 'virtual:lody-worker-wasm';
const resolvedId = `\0${virtualId}`;

/** MV3 listeners must register synchronously; WASM starts only inside the alarm's read lease. */
export function workerWasmPlugin(): Plugin {
  const loroRoot = path.dirname(requireSdk.resolve('loro-crdt/package.json'));
  const flockRoot = path.dirname(path.dirname(requireSdk.resolve('@loro-dev/flock-wasm')));
  return {
    name: 'lody-worker-wasm',
    enforce: 'pre',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
      if (new Set(['loro-crdt', 'loro-crdt/bundler']).has(id))
        return path.join(loroRoot, 'web/index.js');
      return undefined;
    },
    load(id) {
      if (id !== resolvedId) return undefined;
      return `
        import loroInit from ${JSON.stringify(path.join(loroRoot, 'web/index.js'))};
        import loroUrl from ${JSON.stringify(`${path.join(loroRoot, 'web/loro_wasm_bg.wasm')}?url&no-inline`)};
        import flockInit from ${JSON.stringify(path.join(flockRoot, 'bundler/flock_wasm.js'))};
        import flockUrl from ${JSON.stringify(`${path.join(flockRoot, 'bundler/flock_wasm_bg.wasm')}?url&no-inline`)};
        let ready;
        export function initializeWorkerWasm() {
          return ready ??= Promise.all([
            loroInit({ module_or_path: loroUrl }), flockInit(flockUrl)
          ]).catch(error => { ready = undefined; throw error; });
        }
      `;
    },
    transform: {
      order: 'pre',
      handler(code, id) {
        if (id === path.join(flockRoot, 'bundler/wasm.js')) {
          if (!code.includes('await init();'))
            throw new Error(
              'Flock initialization contract changed; review worker WASM integration.',
            );
          return { code: code.replace('await init();', ''), map: null };
        }
        if (id === path.join(flockRoot, 'bundler/flock_wasm.js')) {
          return {
            code: code.replace(
              '"./flock_wasm_bg.wasm"',
              JSON.stringify(`${path.join(flockRoot, 'bundler/flock_wasm_bg.wasm')}?url&no-inline`),
            ),
            map: null,
          };
        }
        if (id === path.join(loroRoot, 'web/loro_wasm.js')) {
          return {
            code: `import packagedLoroWasmUrl from './loro_wasm_bg.wasm?url&no-inline';\n${code.replace("new URL('loro_wasm_bg.wasm', import.meta.url)", 'new URL(packagedLoroWasmUrl, globalThis.location.href)')}`,
            map: null,
          };
        }
        return undefined;
      },
    },
  };
}
