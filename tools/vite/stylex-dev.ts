import type { Plugin } from 'vite';

const cssPath = '/virtual:stylex.css';
const runtimePath = '/@id/virtual:stylex:runtime';

export function stylexDevServer(): Plugin {
  let origin: string | undefined;
  return {
    name: 'lody-stylex-dev-server',
    apply: 'serve',
    configResolved(config) {
      origin = config.server.origin;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!origin) return html;
        return html
          .replaceAll(`src="${runtimePath}"`, `src="${new URL(runtimePath, origin).href}"`)
          .replaceAll(`href="${cssPath}"`, `href="${new URL(cssPath, origin).href}"`);
      },
    },
    transform(code, id) {
      if (id !== 'virtual:stylex:runtime') return;
      return {
        code: code.replace(
          `const DEV_CSS_PATH = '${cssPath}';`,
          `const DEV_CSS_PATH = new URL(import.meta.url).origin + '${cssPath}';`,
        ),
        map: null,
      };
    },
  };
}
