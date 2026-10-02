import { defineConfig } from 'wxt';

import { appPlugins } from './tools/vite/plugins';

export default defineConfig({
  srcDir: 'src',
  publicDir: 'src/public',
  manifest: {
    name: 'Lody',
    description: 'A personal browser workspace with five moods.',
    permissions: ['storage'],
  },
  vite: () => ({ plugins: appPlugins() }),
});
