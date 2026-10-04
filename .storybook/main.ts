import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

import { appPlugins } from '../tools/vite/plugins.ts';
import { wasmConfig } from '../tools/vite/wasm.ts';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  staticDirs: ['../src/public'],
  addons: ['@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
  viteFinal: (config) => {
    const [stylexPlugin, , compilerPlugin] = appPlugins();
    return mergeConfig(wasmConfig(), {
      ...config,
      plugins: [...(config.plugins ?? []), stylexPlugin, compilerPlugin],
    });
  },
};
export default config;
