import { useEffect, useRef, useState } from 'react';

export function useCopyFeedback(duration = 1200) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const copy = async (value: string) => {
    clearTimeout(timerRef.current);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setError('');
      timerRef.current = setTimeout(setCopied, duration, false);
    } catch {
      setCopied(false);
      setError('复制失败，请手动选择文字。');
    }
  };
  return { copied, error, copy };
}
