import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
      include: ['src/features/preferences/{model,storage,state}.ts'],
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage/browser',
    },
  },
});
