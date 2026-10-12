import process from 'node:process';

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/extension',
  workers: Number(process.env.ASSURANCE_EXTENSION_WORKERS ?? 1),
  // Match journey confirmation budgets for Streams reconnect and rendering.
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: process.env.ASSURANCE_RUN_DIRECTORY
          ? `${process.env.ASSURANCE_RUN_DIRECTORY}/extension.json`
          : 'reports/extension.json',
      },
    ],
    ['html', { open: 'never' }],
  ],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
