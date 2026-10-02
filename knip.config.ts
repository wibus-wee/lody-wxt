import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignore: ['vendor/**'],
  entry: [
    'docs/content/**/*.mdx',
    'src/entrypoints/**/*.ts',
    'src/entrypoints/**/*.tsx',
    'tests/e2e/steps/**/*.ts',
    'scripts/*.mjs',
  ],
  project: [
    'src/**/*.{ts,tsx}',
    'web/**/*.{ts,tsx}',
    'docs/**/*.{ts,tsx,mdx}',
    'tools/**/*.ts',
    'tests/**/*.ts',
    '*.ts',
    '.storybook/**/*.{ts,tsx}',
  ],
};
export default config;
