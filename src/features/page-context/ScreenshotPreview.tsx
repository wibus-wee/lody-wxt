import { colors } from '@lody/ui/tokens/colors.stylex';
import * as stylex from '@stylexjs/stylex';
import type { PointerEvent } from 'react';
import { useCallback, useRef, useState } from 'react';

import { Button, Field, Input } from '../../shared/ui';
import { Dialog } from '../../shared/ui/dialog';
import type { Screenshot, ScreenshotRegion } from './screenshot';
import { cropScreenshot } from './screenshot';

const styles = stylex.create({
  viewport: { maxHeight: '45vh', overflowY: 'auto' },
  canvas: { position: 'relative', touchAction: 'none', userSelect: 'none' },
  image: { display: 'block', width: '100%', pointerEvents: 'none' },
  rectangle: (x: number, y: number, width: number, height: number) => ({
    position: 'absolute',
    pointerEvents: 'none',
    border: `2px solid ${colors.accent}`,
    backgroundColor: 'rgb(100 140 230 / 0.16)',
    boxSizing: 'border-box',
    left: `${x}%`,
    top: `${y}%`,
    width: `${width}%`,
    height: `${height}%`,
  }),
  fields: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 },
  status: { fontSize: 13, overflowWrap: 'anywhere' },
});

export function ScreenshotPreview({
  screenshot,
  onAdd,
  onClose,
}: {
  screenshot: Screenshot;
  onAdd: (file: File) => void | Promise<void>;
  onClose: () => void;
}) {
  const [region, setRegion] = useState<ScreenshotRegion>({
    x: 0,
    y: 0,
    width: screenshot.width,
    height: screenshot.height,
  });
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const imageRef = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image) return;
      const objectUrl = URL.createObjectURL(screenshot.file);
      image.src = objectUrl;
      return () => URL.revokeObjectURL(objectUrl);
    },
    [screenshot.file],
  );
  function point(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          screenshot.width,
          Math.round(((event.clientX - bounds.left) * screenshot.width) / bounds.width),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          screenshot.height,
          Math.round(((event.clientY - bounds.top) * screenshot.height) / bounds.height),
        ),
      ),
    };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!startRef.current) return;
    const end = point(event);
    setRegion({
      x: Math.min(startRef.current.x, end.x),
      y: Math.min(startRef.current.y, end.y),
      width: Math.max(1, Math.abs(end.x - startRef.current.x)),
      height: Math.max(1, Math.abs(end.y - startRef.current.y)),
    });
  }
  async function add(crop: boolean) {
    setBusy(true);
    setError('');
    try {
      await onAdd(crop ? await cropScreenshot(screenshot, region) : screenshot.file);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '截图无法附加，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Content>
        <Dialog.Title>附加截图</Dialog.Title>
        <Dialog.Description>
          仅包含采集时的可见页面。拖动框选或按像素设置裁剪区域，关闭后保留草稿。
        </Dialog.Description>
        <p {...stylex.props(styles.status)}>
          {screenshot.width} × {screenshot.height} 像素 ·{' '}
          {new Date(screenshot.capturedAt).toLocaleString()}
        </p>
        <div {...stylex.props(styles.viewport)}>
          {/* Pointer cropping duplicates the labelled numeric fields below. */}
          <div
            {...stylex.props(styles.canvas)}
            role="presentation"
            onPointerDown={(event) => {
              startRef.current = point(event);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={move}
            onPointerUp={(event) => {
              move(event);
              startRef.current = null;
            }}
            onPointerCancel={() => {
              startRef.current = null;
            }}
          >
            <img
              {...stylex.props(styles.image)}
              ref={imageRef}
              alt={`页面截图，${screenshot.width} × ${screenshot.height} 像素`}
            />
            <div
              {...stylex.props(
                styles.rectangle(
                  (region.x / screenshot.width) * 100,
                  (region.y / screenshot.height) * 100,
                  (region.width / screenshot.width) * 100,
                  (region.height / screenshot.height) * 100,
                ),
              )}
            />
          </div>
        </div>
        <div {...stylex.props(styles.fields)}>
          {(
            [
              { key: 'x', label: '左边距' },
              { key: 'y', label: '上边距' },
              { key: 'width', label: '宽度' },
              { key: 'height', label: '高度' },
            ] as const
          ).map(({ key, label }) => (
            <Field.Root key={key}>
              <Field.Label>{label}（像素）</Field.Label>
              <Input
                type="number"
                value={region[key]}
                min={new Set(['x', 'y']).has(key) ? 0 : 1}
                onChange={(event) => setRegion({ ...region, [key]: Number(event.target.value) })}
              />
            </Field.Root>
          ))}
        </div>
        {error && (
          <p role="alert" {...stylex.props(styles.status)}>
            {error}
          </p>
        )}
        <Dialog.Footer>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void add(true)}>
            附加裁剪区域
          </Button>
          <Button disabled={busy} onClick={() => void add(false)}>
            附加整张截图
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
