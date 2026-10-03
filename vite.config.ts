import process from 'node:process';

import { defineConfig } from 'vite';

import { appPlugins } from './tools/vite/plugins.ts';

export default defineConfig({
  root: 'web',
  cacheDir: process.env.LODY_E2E_PORT
    ? `node_modules/.vite/lody-e2e-${process.env.LODY_E2E_PORT}`
    : 'node_modules/.vite/lody-web',
  publicDir: '../src/public',
  base: './',
  plugins: appPlugins(),
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: '../dist/web', emptyOutDir: true },
});
