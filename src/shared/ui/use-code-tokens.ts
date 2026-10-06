import { useEffect, useState } from 'react';
import type { ThemedToken } from 'shiki';

let highlighter:
  | ReturnType<typeof import('./markdown-highlighter').createMarkdownHighlighter>
  | undefined;

export function useCodeTokens(code: string, language: string) {
  const [result, setResult] = useState<{
    code: string;
    language: string;
    lines: ThemedToken[][];
  }>();
  useEffect(() => {
    if (!language || code.length > 20000) return;
    let active = true;
    void import('./markdown-highlighter')
      .then(async (module) => {
        highlighter ??= module.createMarkdownHighlighter();
        const engine = await highlighter;
        if (!engine.getLoadedLanguages().includes(language)) return;
        const tokens = engine.codeToTokens(code, {
          theme: module.MARKDOWN_CODE_THEME_NAME,
          lang: language,
        });
        if (active) setResult({ code, language, lines: tokens.tokens });
      })
      .catch(() => {
        highlighter = undefined;
      });
    return () => {
      active = false;
    };
  }, [code, language]);
  return result?.code === code && result.language === language ? result.lines : undefined;
}
