import tailwindcss from '@tailwindcss/vite';
import { fumadocsMdx } from 'fumadocs-mdx/vite';
import { defineConfig } from 'vite';

import { excalidrawFonts } from '../tools/docs/excalidraw-fonts.ts';
import { docsSearch } from '../tools/docs/search.ts';
import { appPlugins } from '../tools/vite/plugins.ts';

export default defineConfig({
  root: 'docs',
  plugins: [
    fumadocsMdx({ index: false }),
    tailwindcss(),
    docsSearch(),
    excalidrawFonts(),
    ...appPlugins(),
  ],
  server: { host: '127.0.0.1', port: 4000, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
