import { defineConfig } from 'wxt';

import { appPlugins } from './tools/vite/plugins';
import { wasmConfig } from './tools/vite/wasm';
import { workerWasmPlugin } from './tools/vite/worker-wasm';

export default defineConfig({
  srcDir: 'src',
  publicDir: 'src/public',
  manifest: {
    name: 'Lody',
    incognito: 'not_allowed',
    description: 'Lody agent conversations and workspace in your browser.',
    permissions: ['storage', 'activeTab', 'tabs', 'scripting', 'sidePanel', 'contextMenus'],
    host_permissions: [
      'https://backend.lody.ai/*',
      'https://convex.lody.ai/*',
      'https://api.lody.ai/*',
      'https://*.streams-api-x.loro.dev/*',
    ],
    optional_permissions: ['history', 'bookmarks', 'notifications', 'alarms'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    commands: {
      'open-lody': {
        suggested_key: { default: 'Alt+Shift+L', mac: 'Alt+Shift+L' },
        description: '打开 Lody 侧栏',
      },
    },
    side_panel: { default_path: 'sidepanel.html' },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  hooks: {
    'vite:build:extendConfig': (entrypoints, config) => {
      if (entrypoints.some((entry) => entry.type === 'background')) {
        config.plugins = [workerWasmPlugin(), ...(config.plugins ?? [])];
      }
    },
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.browser === 'chrome' && manifest.action) delete manifest.action.default_popup;
    },
  },
  vite: () => {
    const wasm = wasmConfig();
    return { ...wasm, plugins: [...appPlugins(), ...(wasm.plugins ?? [])] };
  },
});
