import { colors } from '@lody/ui/tokens/colors.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';

import { Button, Input } from '../../shared/ui';
import { Dialog } from '../../shared/ui/dialog';
import type { ExtractedPdf } from './pdf';
import { extractPdfText, pdfTextFile } from './pdf';

const styles = stylex.create({
  preview: {
    maxHeight: '40vh',
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontSize: 13,
    lineHeight: 1.6,
  },
  detail: { fontSize: 12, color: colors.secondaryLabel, overflowWrap: 'anywhere' },
});

export function PdfImportDialog({
  onDocument,
  onClose,
}: {
  onDocument: (file: File) => void | Promise<void>;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState<ExtractedPdf | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const operationRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      operationRef.current?.abort();
    },
    [],
  );
  async function read(file?: File) {
    if (!file) return;
    operationRef.current?.abort();
    const operation = new AbortController();
    operationRef.current = operation;
    setBusy(true);
    setError('');
    setPdf(null);
    try {
      const result = await extractPdfText(file, { signal: operation.signal });
      if (!operation.signal.aborted) setPdf(result);
    } catch (cause) {
      if (!operation.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'PDF 读取失败。');
    } finally {
      if (!operation.signal.aborted) setBusy(false);
    }
  }
  async function add() {
    if (!pdf) return;
    setBusy(true);
    setError('');
    try {
      await onDocument(pdfTextFile(pdf));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'PDF 资料无法附加。');
    } finally {
      setBusy(false);
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
        <Dialog.Title>读取 PDF 文字</Dialog.Title>
        <Dialog.Description>
          在本机提取文字层并保留页码，预览确认后附加文字文件。不会执行 PDF 脚本或自动上传原文件。
        </Dialog.Description>
        <Button variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
          选择 PDF 文件
        </Button>
        <span hidden>
          <Input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            aria-label="选择 PDF 文件"
            onChange={(event) => void read(event.target.files?.[0])}
          />
        </span>
        {busy && <output {...stylex.props(styles.detail)}>正在处理 PDF…</output>}
        {error && (
          <p role="alert" {...stylex.props(styles.detail)}>
            {error}
          </p>
        )}
        {pdf && (
          <>
            <p {...stylex.props(styles.detail)}>
              {pdf.name} · {pdf.pageCount} 页{pdf.truncated ? ' · 已达到提取上限，内容不完整' : ''}
              {pdf.emptyPages.length ? ` · ${pdf.emptyPages.length} 页没有文字层` : ''}
            </p>
            <div {...stylex.props(styles.preview)}>
              {pdf.pages.map((page) => (
                <section key={page.page}>
                  <strong>第 {page.page} 页</strong>
                  <p>{page.text || '没有文字层，未执行 OCR。'}</p>
                </section>
              ))}
            </div>
          </>
        )}
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy || !pdf} onClick={() => void add()}>
            附加带页码的文字
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
