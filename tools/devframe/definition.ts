import { readFile } from 'node:fs/promises';

import { defineDevframe, defineRpcFunction } from 'devframe';

export default defineDevframe({
  id: 'lody-foundation',
  name: 'Lody Foundation',
  version: '0.1.0',
  packageName: 'lody-wxt',
  homepage: 'https://github.com/wibus-wee/lody-wxt',
  description: 'Read-only journey coverage and project metadata.',
  importMetaUrl: import.meta.url,
  cli: { command: 'lody-tools', port: 9876, host: '127.0.0.1', open: false },
  setup(ctx) {
    const scope = ctx.scope('lody-foundation');
    scope.rpc.register(
      defineRpcFunction({
        name: 'coverage',
        type: 'query',
        jsonSerializable: true,
        handler: async () => ({
          markdown: await readFile(new URL('../../COVERAGE.md', import.meta.url), 'utf8'),
        }),
      }),
    );
    scope.rpc.register(
      defineRpcFunction({
        name: 'metadata',
        type: 'static',
        jsonSerializable: true,
        handler: () => ({
          runtime: 'WXT',
          surfaces: ['popup', 'options', 'web'],
          moods: ['outline', 'duotone', 'fill', 'pixel', 'glass'],
        }),
      }),
    );
  },
});
