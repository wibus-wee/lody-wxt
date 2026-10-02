import { defineConfig } from 'vite';

import { appPlugins } from './tools/vite/plugins.ts';

export default defineConfig({
  root: 'web',
  publicDir: '../src/public',
  base: './',
  plugins: appPlugins(),
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: '../dist/web', emptyOutDir: true },
});
