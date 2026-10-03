import { fileURLToPath } from 'node:url';

import { defineConfig } from 'wxt';

import { appPlugins } from './tools/vite/plugins';

export default defineConfig({
  srcDir: 'src',
  publicDir: 'src/public',
  manifest: {
    name: 'Lody',
    description: 'Lody Agent conversations beside your web, with explicit page attachments.',
    permissions: ['storage', 'sidePanel', 'activeTab', 'scripting', 'tabs'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    side_panel: { default_path: 'sidepanel.html' },
  },
  vite: () => ({
    plugins: appPlugins(),
    resolve: {
      alias: {
        './create-code-worker': fileURLToPath(
          new URL('./src/shared/ui/create-extension-code-worker.ts', import.meta.url),
        ),
      },
    },
  }),
});
