import type { Plugin, UserConfig } from 'vite';

const loroImport = /^loro-crdt$/;

const wasmDependencies = [
  'loro-crdt',
  'loro-repo',
  '@loro-dev/flock-wasm',
  '@loro-dev/streams-crdt',
];

export function wasmConfig(): UserConfig {
  return {
    resolve: { alias: [{ find: loroImport, replacement: 'loro-crdt/bundler' }] },
    optimizeDeps: { exclude: wasmDependencies },
    build: { target: 'es2022' },
    worker: { format: 'es' },
    plugins: [wasmAssets()],
  };
}

function wasmAssets(): Plugin {
  return {
    name: 'lody-wasm-assets',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('/loro-crdt/bundler/loro_wasm.js')) {
        return {
          code: code.replaceAll('./loro_wasm_bg.wasm', './loro_wasm_bg.wasm?url'),
          map: null,
        };
      }
      if (id.includes('/@loro-dev/flock-wasm/bundler/flock_wasm.js')) {
        return {
          code: code
            .replaceAll('./flock_wasm_bg.wasm', './flock_wasm_bg.wasm?url')
            .replace(
              'return instantiateWasm(fetch(requestTarget));',
              'return instantiateWasm(await (await fetch(requestTarget)).arrayBuffer());',
            ),
          map: null,
        };
      }
      return undefined;
    },
  };
}
