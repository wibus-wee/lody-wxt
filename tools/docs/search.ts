import { globSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { frontmatter } from 'fumadocs-core/content/md/frontmatter';
import { createSearchAPI } from 'fumadocs-core/search/server';
import * as v from 'valibot';
import type { Plugin } from 'vite';

const root = fileURLToPath(new URL('../../docs/contents/', import.meta.url));
const schema = v.object({ title: v.string(), description: v.optional(v.string(), '') });
const suffix = /\.mdx$/;
const indexSuffix = /\/index$/;
const diagramTag = /^<Diagram\s[^>]*\/>\s*$/gm;

// Fumadocs' static client reads this export; the deployed site needs no search server.
export function docsSearch(): Plugin {
  const exports = new Map<boolean, Promise<string>>();
  function getExport(dev: boolean) {
    const cached = exports.get(dev);
    if (cached) return cached;
    const exported = (async () => {
      const indexes = [...globSync(`${root}/**/*.mdx`)].sort().map((file) => {
        const { data, content } = frontmatter(readFileSync(file, 'utf8'));
        const metadata = v.parse(schema, data);
        const path = relative(root, file).replace(suffix, '');
        return {
          ...metadata,
          url: `/docs/${path}`.replace(indexSuffix, ''),
          content: content.replace(diagramTag, ''),
          breadcrumbs: [path.startsWith('dev/') ? '开发资料' : '产品文档'],
        };
      });
      return JSON.stringify(
        await createSearchAPI('simple', {
          indexes: indexes.filter((index) => index.url.startsWith('/docs/dev') === dev),
        }).export(),
      );
    })();
    exports.set(dev, exported);
    return exported;
  }
  return {
    name: 'docs-static-search',
    configureServer(server) {
      const invalidate = (file: string) => {
        if (file.startsWith(root) && file.endsWith('.mdx')) exports.clear();
      };
      server.watcher.on('change', invalidate);
      server.watcher.on('add', invalidate);
      server.watcher.on('unlink', invalidate);
      for (const dev of [false, true]) {
        server.middlewares.use(
          dev ? '/docs-dev-search.json' : '/docs-search.json',
          (_request, response, next) => {
            void getExport(dev)
              .then((data) => {
                response.setHeader('Content-Type', 'application/json; charset=utf-8');
                response.setHeader('Cache-Control', 'no-store');
                response.end(data);
              })
              .catch(next);
          },
        );
      }
    },
    async generateBundle() {
      for (const dev of [false, true]) {
        this.emitFile({
          type: 'asset',
          fileName: dev ? 'docs-dev-search.json' : 'docs-search.json',
          source: await getExport(dev),
        });
      }
    },
  };
}
