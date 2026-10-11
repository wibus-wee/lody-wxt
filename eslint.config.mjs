import { defineConfig } from 'eslint-config-hyoban';

export default defineConfig({
  react: true,
  stylistic: false,
  formatters: false,
  rules: { 'md/no-url-trailing-slash': 'off' },
  ignores: [
    'vendor/**',
    '.wxt/**',
    '.output/**',
    'dist/**',
    'docs/dist/**',
    'coverage/**',
    'reports/**',
    'storybook-static/**',
    'src/shared/icons/generated.ts',
    'COVERAGE.md',
  ],
}).append(
  {
    files: ['.github/autonomous-maintenance-policy.yml'],
    // JSON is intentional YAML syntax: trusted orchestration parses it without installing dependencies.
    rules: {
      'yaml/plain-scalar': 'off',
      'yaml/block-sequence': 'off',
      'yaml/block-mapping': 'off',
    },
  },
  {
    files: ['package.json', 'packages/*/package.json'],
    // Oxfmt owns package ordering so the formatter and Hyoban preset stay consistent.
    rules: { 'jsonc/sort-keys': 'off' },
  },
  {
    files: [
      'packages/lody-sdk/test/*.test.mjs',
      'tools/assurance/*.test.mjs',
      'tools/autonomy/*.test.mjs',
      'tools/release/*.test.mjs',
    ],
    // The standalone SDK tests execute the built package through Node's test runner.
    rules: { 'test/no-import-node-test': 'off', 'antfu/no-import-dist': 'off' },
  },
);
