import process from 'node:process';

import babel from '@rolldown/plugin-babel';
import stylex from '@stylexjs/unplugin';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

import { stylexOptions } from '../../vendor/lody/packages/ui/stylex-options.ts';
import { stylexDevServer } from './stylex-dev.ts';

export function appPlugins() {
  return [
    {
      name: 'lody-source-packages',
      config: () => ({
        resolve: { dedupe: ['react', 'react-dom', '@base-ui/react', '@stylexjs/stylex'] },
        optimizeDeps: {
          exclude: ['@lody/ui'],
          include: [
            'button',
            'dialog',
            'field',
            'input',
            'menu',
            'popover',
            'select',
            'switch',
            'tooltip',
            'use-render',
          ]
            .map((entry) => `@lody/ui > @base-ui/react/${entry}`)
            .concat('@base-ui/react/menu'),
        },
        server: { fs: { allow: [process.cwd()] } },
      }),
    } satisfies Plugin,
    stylex.vite({
      ...stylexOptions,
      useCSSLayers: {
        ...stylexOptions.useCSSLayers,
        before: ['reset', ...stylexOptions.useCSSLayers.before],
      },
      cssInjectionTarget: (file) => file.endsWith('.css'),
      runtimeInjection: false,
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    stylexDevServer(),
  ];
}
