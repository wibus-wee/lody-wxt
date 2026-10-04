import { defineConfig } from 'wxt';

import { appPlugins } from './tools/vite/plugins';
import { wasmConfig } from './tools/vite/wasm';

export default defineConfig({
  srcDir: 'src',
  publicDir: 'src/public',
  manifest: {
    name: 'Lody',
    description: 'Lody agent conversations and workspace in your browser.',
    permissions: ['storage', 'activeTab', 'tabs', 'scripting', 'sidePanel'],
    host_permissions: [
      'https://backend.lody.ai/*',
      'https://convex.lody.ai/*',
      'https://api.lody.ai/*',
      'https://*.streams-api-x.loro.dev/*',
    ],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    side_panel: { default_path: 'sidepanel.html' },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.browser === 'chrome' && manifest.action) delete manifest.action.default_popup;
    },
  },
  vite: () => {
    const wasm = wasmConfig();
    return { ...wasm, plugins: [...appPlugins(), ...(wasm.plugins ?? [])] };
  },
});
