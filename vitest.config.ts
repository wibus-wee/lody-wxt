import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { wasmConfig } from './tools/vite/wasm.ts';

const filesystemTests = [
  'tests/browser/update-directory.browser.test.ts',
  'tests/browser/update-binding.browser.test.ts',
];

export default defineConfig({
  ...wasmConfig(),
  cacheDir: 'node_modules/.vite/browser-tests',
  test: {
    projects: [
      {
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.browser.test.ts'],
          exclude: filesystemTests,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        test: {
          name: 'filesystem',
          include: filesystemTests,
          fileParallelism: false,
          browser: {
            enabled: true,
            // The extension prohibits incognito. Its directory handles must be tested
            // in a real profile, not Chromium 153's crashing in-memory IDB backend:
            // https://issuetracker.google.com/issues/564001201
            provider: playwright({
              launchOptions: { channel: 'chromium' },
              persistentContext: path.join(tmpdir(), `lody-filesystem-tests-${randomUUID()}`),
            }),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: [
        'src/features/preferences/{model,storage,state}.ts',
        'src/features/account/{controller,model,storage}.ts',
        'src/features/conversations/{controller,model,storage}.ts',
        'src/features/page-context/{actions,capture}.ts',
        'src/features/updates/{archive,directory-binding,directory-transaction}.ts',
      ],
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage/browser',
    },
  },
});
