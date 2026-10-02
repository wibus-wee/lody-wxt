import { fumadocsMdx } from 'fumadocs-mdx/vite';
import { defineConfig } from 'vite';

import { appPlugins } from '../tools/vite/plugins.ts';

export default defineConfig({
  root: 'docs',
  base: './',
  plugins: [fumadocsMdx({ index: false }), ...appPlugins()],
  server: { host: '127.0.0.1', port: 4000, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
