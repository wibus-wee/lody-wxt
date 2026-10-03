import type { BundledLanguage } from 'shiki';

import {
  createMarkdownHighlighter,
  tokenizeMarkdownCode,
} from '../../../vendor/lody/packages/components/src/lib/markdown-highlighter';

export function registerMarkdownHighlightWorker() {
  let highlighter: ReturnType<typeof createMarkdownHighlighter> | undefined;
  globalThis.onmessage = async (
    event: MessageEvent<{ id: number; code: string; language: string }>,
  ) => {
    const { id, code, language } = event.data;
    try {
      highlighter ??= createMarkdownHighlighter();
      const result = tokenizeMarkdownCode(
        await highlighter,
        code.slice(0, 20000),
        language as BundledLanguage,
      );
      globalThis.postMessage({ id, lines: result.tokens });
    } catch {
      globalThis.postMessage({ id, lines: null });
    }
  };
}
