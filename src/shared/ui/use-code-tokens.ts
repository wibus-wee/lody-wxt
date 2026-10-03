import { useEffect, useState } from 'react';
import type { ThemedToken } from 'shiki';

import { createCodeWorker } from './create-code-worker';

let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<number, (lines: ThemedToken[][]) => void>();
function highlightWorker() {
  if (!worker) {
    worker = createCodeWorker();
    worker.onmessage = (event: MessageEvent<{ id: number; lines: ThemedToken[][] | null }>) => {
      const callback = pending.get(event.data.id);
      pending.delete(event.data.id);
      if (event.data.lines) callback?.(event.data.lines);
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = undefined;
      pending.clear();
    };
  }
  return worker;
}

export function useCodeTokens(code: string, language: string) {
  const [result, setResult] = useState<{
    code: string;
    language: string;
    lines: ThemedToken[][];
  }>();
  useEffect(() => {
    if (!language || code.length > 20000) return;
    const id = ++sequence;
    pending.set(id, (lines) => setResult({ code, language, lines }));
    try {
      highlightWorker().postMessage({ id, code, language });
    } catch {
      pending.delete(id);
    }
    return () => {
      pending.delete(id);
    };
  }, [code, language]);
  return result?.code === code && result.language === language ? result.lines : undefined;
}
