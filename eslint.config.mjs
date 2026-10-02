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
}).append({
  files: ['package.json'],
  // Oxfmt owns package ordering so the formatter and Hyoban preset stay consistent.
  rules: { 'jsonc/sort-keys': 'off' },
});
