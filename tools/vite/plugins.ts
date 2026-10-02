import babel from '@rolldown/plugin-babel';
import stylex from '@stylexjs/unplugin';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';

export function appPlugins() {
  return [
    stylex.vite({ useCSSLayers: true, runtimeInjection: false }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ];
}
