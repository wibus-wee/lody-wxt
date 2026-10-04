import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { wasmConfig } from './tools/vite/wasm.ts';

export default defineConfig({
  ...wasmConfig(),
  cacheDir: 'node_modules/.vite/browser-tests',
  test: {
    include: ['tests/browser/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
    coverage: {
      provider: 'v8',
      include: [
        'src/features/preferences/{model,storage,state}.ts',
        'src/features/account/{controller,model,storage}.ts',
        'src/features/conversations/{controller,model,storage}.ts',
        'src/features/page-context/{actions,capture}.ts',
      ],
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage/browser',
    },
  },
});
