import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';

import { Alert, Button, Field, Textarea } from '../../shared/ui';
import { ActivityStatus } from '../../shared/ui/ActivityStatus';
import { Dialog } from '../../shared/ui/dialog';
import { Select } from '../../shared/ui/select';
import type { SpeechRecognitionPort } from './recognition';
import { createRecognition, recognitionText } from './recognition';

const languages = [
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'zh-TW', label: '中文（繁體）' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'es-ES', label: 'Español' },
] as const;

function defaultLanguage() {
  const preferred = navigator.language.toLowerCase();
  return (
    languages.find((language) => language.value.toLowerCase() === preferred)?.value ??
    languages.find((language) => language.value.slice(0, 2) === preferred.slice(0, 2))?.value ??
    'zh-CN'
  );
}

const styles = stylex.create({
  body: { display: 'grid', gap: 12 },
  preview: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 },
});
export function DictationDialog({
  onInsert,
  onClose,
}: {
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const [language, setLanguage] = useState(defaultLanguage);
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [phase, setPhase] = useState<'idle' | 'starting' | 'listening' | 'stopping'>('idle');
  const [error, setError] = useState('');
  const recognitionRef = useRef<SpeechRecognitionPort | null>(null);
  const liveRef = useRef(false);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      recognitionRef.current?.abort();
    };
  }, []);
  const busy = phase !== 'idle';
  async function start() {
    setError('');
    setPhase('starting');
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('此浏览器无法请求麦克风权限，请在浏览器设置中允许麦克风后重试。');
      }
      // Trigger the browser's microphone permission prompt from the user's click.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      stream = undefined;
      if (!liveRef.current) return;

      const recognition = createRecognition();
      recognitionRef.current = recognition;
      recognition.lang = language;
      recognition.continuous = false;
      recognition.interimResults = true;
      const prior = text;
      const current = () => liveRef.current && recognitionRef.current === recognition;
      recognition.onstart = () => {
        if (current()) setPhase('listening');
      };
      recognition.onresult = (event) => {
        if (!current()) return;
        const result = recognitionText(event.results);
        setText(prior + (prior && result.final ? '\n' : '') + result.final);
        setInterim(result.interim);
      };
      recognition.onerror = (event) => {
        if (!current()) return;
        setError(
          new Set(['not-allowed', 'service-not-allowed']).has(event.error)
            ? '浏览器拒绝了麦克风或语音识别请求。请在浏览器的 Lody 网站权限中允许麦克风后重试。已有文字已保留。'
            : `听写未完成（${event.error}）。已有文字已保留，可重新开始。`,
        );
        setPhase('idle');
      };
      recognition.onend = () => {
        if (current()) {
          setPhase('idle');
          setInterim('');
        }
      };
      recognition.start();
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      setPhase('idle');
      const error = reason instanceof Error ? reason : undefined;
      setError(
        new Set(['NotAllowedError', 'SecurityError']).has(error?.name ?? '')
          ? '麦克风权限未获准。请在浏览器的 Lody 网站权限中允许麦克风，然后重试。'
          : (error?.message ?? '无法开始听写。'),
      );
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content>
        <Dialog.Title>语音输入</Dialog.Title>
        <Dialog.Description>
          使用浏览器的语音识别服务，音频可能由浏览器厂商在线处理。Lody
          不保存原始音频；识别文字经你确认后加入草稿，不会自动发送。
        </Dialog.Description>
        <div {...stylex.props(styles.body)}>
          <Field.Root disabled={busy}>
            <Field.Label>识别语言</Field.Label>
            <Select.Root
              value={language}
              onValueChange={(value) => {
                if (value !== null) setLanguage(value);
              }}
            >
              <Select.Trigger aria-label="识别语言">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {languages.map((item) => (
                  <Select.Item key={item.value} value={item.value}>
                    {item.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Field.Root>
          <Textarea
            resize="none"
            aria-label="听写文字"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={busy}
            maxLength={16000}
          />
          {interim && <p {...stylex.props(styles.preview)}>{interim}</p>}
          {busy && (
            <ActivityStatus busy>
              {phase === 'starting' ? '等待麦克风' : phase === 'stopping' ? '结束听写' : '正在听写'}
            </ActivityStatus>
          )}
          {error && (
            <Alert.Root tone="danger">
              <Alert.Description>{error}</Alert.Description>
            </Alert.Root>
          )}
        </div>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          {busy ? (
            <Button
              variant="secondary"
              disabled={phase === 'stopping'}
              onClick={() => {
                setPhase('stopping');
                recognitionRef.current?.stop();
              }}
            >
              结束听写
            </Button>
          ) : (
            <Button variant="secondary" onClick={start} disabled={!language}>
              开始听写
            </Button>
          )}
          <Button
            disabled={busy || !text.trim()}
            onClick={() => {
              onInsert(text);
              onClose();
            }}
          >
            加入草稿
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
