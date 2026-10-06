import { createRequire } from 'node:module';
import path from 'node:path';

import type { Plugin, UserConfig } from 'vite';

import { sharedFlockWasmAsset, sharedFlockWasmUrl } from './shared-flock-wasm';
import { sharedLoroWasmAsset, sharedLoroWasmUrl } from './shared-loro-wasm';

const loroImport = /^loro-crdt$/;
const loroWebInitImport = 'loro-crdt/web/loro_wasm.js';
const loroInitializerId = 'virtual:lody-loro-wasm';
const resolvedLoroInitializerId = `\0${loroInitializerId}`;
const requireSdk = createRequire(new URL('../../packages/lody-sdk/package.json', import.meta.url));
const loroRoot = path.dirname(requireSdk.resolve('loro-crdt/package.json'));

const wasmDependencies = [
  'loro-crdt',
  'loro-repo',
  '@loro-dev/flock-wasm',
  '@loro-dev/streams-crdt',
];

export function wasmConfig({
  loroBuild = 'bundler',
}: { loroBuild?: 'bundler' | 'web' } = {}): UserConfig {
  return {
    resolve: {
      alias: [
        ...(loroBuild === 'web'
          ? [{ find: loroWebInitImport, replacement: path.join(loroRoot, 'web/loro_wasm.js') }]
          : []),
        { find: loroImport, replacement: `loro-crdt/${loroBuild}` },
      ],
    },
    optimizeDeps: { exclude: wasmDependencies },
    build: { target: 'es2022' },
    worker: { format: 'es' },
    plugins: [
      sharedFlockWasmAsset(),
      ...(loroBuild === 'web' ? [sharedLoroWasmAsset()] : []),
      loroInitializerPlugin(loroBuild),
      wasmAssets(loroBuild),
    ],
  };
}

function loroInitializerPlugin(loroBuild: 'bundler' | 'web'): Plugin {
  return {
    name: 'lody-loro-initializer',
    resolveId(id) {
      return id === loroInitializerId ? resolvedLoroInitializerId : undefined;
    },
    load(id) {
      if (id !== resolvedLoroInitializerId) return undefined;
      if (loroBuild === 'bundler')
        return 'export function initializeLoroWasm() { return Promise.resolve(); }';
      return `
        import initialize from ${JSON.stringify(path.join(loroRoot, 'web/loro_wasm.js'))};
        let ready;
        export function initializeLoroWasm() {
          return ready ??= initialize({ module_or_path: new URL(${JSON.stringify(sharedLoroWasmUrl)}, globalThis.location.href) })
            .catch(error => { ready = undefined; throw error; });
        }
      `;
    },
  };
}

function wasmAssets(loroBuild: 'bundler' | 'web'): Plugin {
  return {
    name: 'lody-wasm-assets',
    enforce: 'pre',
    transform(code, id) {
      if (loroBuild === 'web' && id.includes('/loro-crdt/web/loro_wasm.js')) {
        return {
          code: code.replace(
            "new URL('loro_wasm_bg.wasm', import.meta.url)",
            `new URL(${JSON.stringify(sharedLoroWasmUrl)}, globalThis.location.href)`,
          ),
          map: null,
        };
      }
      if (loroBuild === 'bundler' && id.includes('/loro-crdt/bundler/loro_wasm.js')) {
        return {
          code: code.replaceAll('./loro_wasm_bg.wasm', './loro_wasm_bg.wasm?url'),
          map: null,
        };
      }
      if (id.includes('/@loro-dev/flock-wasm/bundler/flock_wasm.js')) {
        return {
          code: code
            .replace(
              'import * as wasmModule from "./flock_wasm_bg.wasm";',
              `const wasmModule = ${JSON.stringify(sharedFlockWasmUrl)};`,
            )
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
