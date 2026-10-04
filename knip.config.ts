import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignore: ['vendor/**'],
  // The packed SDK fixture resolves runtime dependencies from its isolated consumer directory.
  ignoreIssues: { 'tests/sdk-consumer/consumer.mjs': ['unlisted'] },
  workspaces: {
    '.': {
      entry: [
        'docs/content/**/*.mdx',
        'src/entrypoints/**/*.ts',
        'src/entrypoints/**/*.tsx',
        'tests/e2e/steps/**/*.ts',
        'tests/sdk-consumer/*.{mjs,mts}',
        'scripts/*.mjs',
        'tools/assurance/*.test.mjs',
        'tests/e2e/journey-steps/**/*.ts',
      ],
      // Upstream UI runtime entrypoints import Base UI from the root installation.
      ignoreDependencies: ['@base-ui/react'],
      project: [
        'src/**/*.{ts,tsx}',
        'web/**/*.{ts,tsx}',
        'docs/**/*.{ts,tsx,mdx}',
        'tools/**/*.ts',
        'tests/**/*.{ts,mts,mjs}',
        '*.ts',
        '.storybook/**/*.{ts,tsx}',
      ],
    },
    'packages/lody-sdk': {
      // ofetch's Node declarations import undici; the alias supplies types without a runtime dependency.
      ignoreDependencies: ['undici'],
      ignoreExportsUsedInFile: { function: true },
      entry: ['src/data-wire.ts', 'test/*.test.mjs', 'scripts/*.mjs'],
      project: ['src/**/*.ts', 'test/*.test.mjs', 'scripts/*.mjs'],
    },
  },
};
export default config;
