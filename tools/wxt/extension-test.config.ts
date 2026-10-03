import process from 'node:process';

import { defineConfig } from 'wxt';

import config from '../../wxt.config.ts';

export default defineConfig({
  ...config,
  root: process.cwd(),
  outDir: '.output/extension-test',
  dev: { server: { port: 3081, strictPort: true } },
  webExt: { disabled: true },
});
