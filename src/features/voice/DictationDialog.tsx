import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';

import { Alert, Button, Field, Input, Textarea } from '../../shared/ui';
import { ActivityStatus } from '../../shared/ui/ActivityStatus';
import { Dialog } from '../../shared/ui/dialog';
import type { SpeechRecognitionPort } from './recognition';
import { createRecognition, recognitionText } from './recognition';

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
  const [language, setLanguage] = useState(navigator.language || 'zh-CN');
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
  function start() {
    setError('');
    try {
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
            ? '麦克风或识别服务未获授权。已有文字已保留。'
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
      setPhase('starting');
      recognition.start();
    } catch (reason) {
      setPhase('idle');
      setError(reason instanceof Error ? reason.message : '无法开始听写。');
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
            <Input
              aria-label="识别语言"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              placeholder="zh-CN"
            />
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
            <Button variant="secondary" onClick={start} disabled={!language.trim()}>
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
