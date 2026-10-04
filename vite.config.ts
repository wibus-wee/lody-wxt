import { defineConfig, mergeConfig } from 'vite';

import { appPlugins } from './tools/vite/plugins.ts';
import { wasmConfig } from './tools/vite/wasm.ts';

export default defineConfig(
  mergeConfig(wasmConfig(), {
    root: 'web',
    cacheDir: '../node_modules/.vite/web',
    publicDir: '../src/public',
    base: './',
    plugins: appPlugins(),
    server: { host: '127.0.0.1', port: 4173, strictPort: true },
    build: { outDir: '../dist/web', emptyOutDir: true },
  }),
);
