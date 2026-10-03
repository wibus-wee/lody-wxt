import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/extension',
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/extension.json' }],
    ['html', { open: 'never' }],
  ],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'pnpm exec wxt --config tools/wxt/extension-test.config.ts',
    url: 'http://localhost:3081/virtual:stylex.css',
    reuseExistingServer: false,
  },
});
