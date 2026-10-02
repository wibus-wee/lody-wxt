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
});
