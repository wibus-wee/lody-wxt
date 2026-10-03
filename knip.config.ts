import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignore: ['vendor/**'],
  ignoreWorkspaces: ['vendor/lody/packages/ui'],
  workspaces: {
    '.': {
      entry: [
        'docs/content/**/*.mdx',
        'src/entrypoints/**/*.ts',
        'src/entrypoints/**/*.tsx',
        'tests/e2e/steps/**/*.ts',
        'scripts/*.mjs',
        'tools/wxt/*.config.ts',
        'tests/extension/fixtures/*.ts',
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
    },
  },
};
export default config;
