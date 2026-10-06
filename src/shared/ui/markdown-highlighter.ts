import { createCssVariablesTheme, createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

export const MARKDOWN_CODE_THEME_NAME = 'lody-css-variables';

const languageLoaders = [
  () => import('shiki/langs/typescript.mjs'),
  () => import('shiki/langs/tsx.mjs'),
  () => import('shiki/langs/javascript.mjs'),
  () => import('shiki/langs/jsx.mjs'),
  () => import('shiki/langs/json.mjs'),
  () => import('shiki/langs/bash.mjs'),
  () => import('shiki/langs/shellscript.mjs'),
  () => import('shiki/langs/markdown.mjs'),
  () => import('shiki/langs/python.mjs'),
  () => import('shiki/langs/rust.mjs'),
  () => import('shiki/langs/go.mjs'),
  () => import('shiki/langs/yaml.mjs'),
  () => import('shiki/langs/html.mjs'),
  () => import('shiki/langs/css.mjs'),
  () => import('shiki/langs/c.mjs'),
  () => import('shiki/langs/cpp.mjs'),
  () => import('shiki/langs/csharp.mjs'),
  () => import('shiki/langs/java.mjs'),
  () => import('shiki/langs/kotlin.mjs'),
  () => import('shiki/langs/swift.mjs'),
  () => import('shiki/langs/ruby.mjs'),
  () => import('shiki/langs/php.mjs'),
  () => import('shiki/langs/sql.mjs'),
  () => import('shiki/langs/graphql.mjs'),
  () => import('shiki/langs/toml.mjs'),
  () => import('shiki/langs/xml.mjs'),
  () => import('shiki/langs/dockerfile.mjs'),
] as const;

export type MarkdownHighlighter = Awaited<ReturnType<typeof createMarkdownHighlighter>>;
export type MarkdownTokens = ReturnType<MarkdownHighlighter['codeToTokens']>;

export async function createMarkdownHighlighter() {
  const langs = await Promise.all(languageLoaders.map(async (load) => (await load()).default));
  return createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    langs,
    themes: [
      createCssVariablesTheme({
        name: MARKDOWN_CODE_THEME_NAME,
        variablePrefix: '--lody-shiki-',
      }),
    ],
  });
}
