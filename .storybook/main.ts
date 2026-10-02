import type { StorybookConfig } from '@storybook/react-vite';

import { appPlugins } from '../tools/vite/plugins.ts';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  staticDirs: ['../src/public'],
  addons: ['@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
  viteFinal: (config) => {
    const [stylexPlugin, , compilerPlugin] = appPlugins();
    return { ...config, plugins: [...(config.plugins ?? []), stylexPlugin, compilerPlugin] };
  },
};
export default config;
