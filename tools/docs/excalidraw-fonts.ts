import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vite';

// Excalifont uses Xiaolai for Chinese. Serve both locally so canvas typography
// survives offline use and does not depend on Excalidraw's CDN fallback.
export function excalidrawFonts(): Plugin {
  const root = join(dirname(fileURLToPath(import.meta.resolve('@excalidraw/excalidraw'))), 'fonts');
  const files = new Map<string, string>();
  const methods = new Set(['GET', 'HEAD']);
  for (const family of ['Excalifont', 'Xiaolai']) {
    for (const name of readdirSync(join(root, family))) {
      if (name.endsWith('.woff2')) files.set(`${family}/${name}`, join(root, family, name));
    }
  }
  return {
    name: 'docs-excalidraw-fonts',
    configureServer(server) {
      server.middlewares.use('/excalidraw/fonts', (request, response, next) => {
        const path = request.url?.split('?')[0]?.slice(1);
        const file = path ? files.get(path) : undefined;
        if (!file || !methods.has(request.method ?? '')) return next();
        response.setHeader('Content-Type', 'font/woff2');
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        response.end(request.method === 'HEAD' ? undefined : readFileSync(file));
      });
    },
    generateBundle() {
      for (const [path, file] of files) {
        this.emitFile({
          type: 'asset',
          fileName: `excalidraw/fonts/${path}`,
          source: readFileSync(file),
        });
      }
    },
  };
}
