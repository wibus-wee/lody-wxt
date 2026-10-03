import type { StorybookConfig } from '@storybook/react-vite';

import { appPlugins } from '../tools/vite/plugins.ts';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  staticDirs: ['../src/public'],
  addons: ['@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
  viteFinal: (config) => {
    const [sourcePlugin, stylexPlugin, , compilerPlugin, stylexDevPlugin] = appPlugins();
    return {
      ...config,
      plugins: [
        ...(config.plugins ?? []),
        sourcePlugin,
        stylexPlugin,
        compilerPlugin,
        stylexDevPlugin,
      ],
    };
  },
};
export default config;
