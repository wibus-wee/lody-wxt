/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-interactions -- The full-viewport crop canvas owns pointer and keyboard boundaries inside the injected shadow root; its controls use Lody UI and numeric fields provide keyboard selection. */
import { colors } from '@lody/ui/tokens/colors.stylex';
import * as stylex from '@stylexjs/stylex';
import type { PointerEvent } from 'react';
import { useCallback, useRef, useState } from 'react';

import { Button, Field, Input } from '../../shared/ui';
import type { ScreenshotRegion } from './screenshot';
import type { ScreenshotSelection } from './screenshot-protocol';

const styles = stylex.create({
  surface: {
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    maxWidth: 'none',
    maxHeight: 'none',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 14,
    lineHeight: 1.5,
    color: colors.label,
    backgroundColor: colors.background,
  },
  canvas: {
    position: 'absolute',
    inset: 0,
    touchAction: 'none',
    userSelect: 'none',
    cursor: 'crosshair',
  },
  image: { display: 'block', width: '100%', height: '100%', pointerEvents: 'none' },
  rectangle: (x: number, y: number, width: number, height: number) => ({
    position: 'absolute',
    pointerEvents: 'none',
    border: `2px solid ${colors.accent}`,
    backgroundColor: 'rgb(100 140 230 / 0.16)',
    boxShadow: '0 0 0 100vmax rgb(0 0 0 / 0.4)',
    boxSizing: 'border-box',
    left: `${x}%`,
    top: `${y}%`,
    width: `${width}%`,
    height: `${height}%`,
  }),
  toolbar: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    width: 'fit-content',
    maxWidth: 'calc(100% - 32px)',
    maxHeight: '45vh',
    overflowY: 'auto',
    marginInline: 'auto',
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.background,
    boxShadow: '0 8px 32px rgb(0 0 0 / 0.24)',
  },
  title: { margin: 0, fontSize: 16, fontWeight: 600 },
  description: { marginBlock: 8 },
  fields: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 },
  input: { width: '100%', minWidth: 0 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  status: { fontSize: 13, overflowWrap: 'anywhere' },
});

export function ScreenshotOverlay({
  data,
  width,
  height,
  onSelect,
}: {
  data: string;
  width: number;
  height: number;
  onSelect: (selection: ScreenshotSelection) => void;
}) {
  const [region, setRegion] = useState<ScreenshotRegion>({ x: 0, y: 0, width, height });
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [error, setError] = useState('');
  const focusCancel = useCallback((button: HTMLButtonElement | null) => {
    button?.focus({ preventScroll: true });
  }, []);
  function point(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(width, Math.round(((event.clientX - bounds.left) * width) / bounds.width)),
      ),
      y: Math.max(
        0,
        Math.min(height, Math.round(((event.clientY - bounds.top) * height) / bounds.height)),
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
  function crop() {
    if (
      ![region.x, region.y, region.width, region.height].every(Number.isInteger) ||
      region.x < 0 ||
      region.y < 0 ||
      region.width < 1 ||
      region.height < 1 ||
      region.x + region.width > width ||
      region.y + region.height > height
    ) {
      setError('裁剪范围必须在截图内，且宽高至少为 1 像素。');
      return;
    }
    onSelect({ type: 'crop', region });
  }
  return (
    <div
      {...stylex.props(styles.surface)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lody-screenshot-title"
      aria-describedby="lody-screenshot-description"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onSelect({ type: 'cancel' });
        }
        if (event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button,input')];
        const focused = event.currentTarget.getRootNode() as ShadowRoot;
        const index = controls.indexOf(focused.activeElement as HTMLElement);
        const next = (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        event.preventDefault();
        controls[next]?.focus();
      }}
    >
      {/* Numeric fields provide the keyboard equivalent of pointer selection. */}
      <div
        {...stylex.props(styles.canvas)}
        role="presentation"
        data-testid="screenshot-canvas"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
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
          src={data}
          alt={`页面截图，${width} × ${height} 像素`}
        />
        <div
          {...stylex.props(
            styles.rectangle(
              (region.x / width) * 100,
              (region.y / height) * 100,
              (region.width / width) * 100,
              (region.height / height) * 100,
            ),
          )}
        />
      </div>
      <div {...stylex.props(styles.toolbar)}>
        <h2 id="lody-screenshot-title" {...stylex.props(styles.title)}>
          截取可见内容
        </h2>
        <p id="lody-screenshot-description" {...stylex.props(styles.description)}>
          在网页上拖动框选，或按像素设置区域。Esc 取消，确认后附加到 Lody 草稿。
        </p>
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
                {...stylex.props(styles.input)}
                type="number"
                value={region[key]}
                min={new Set(['x', 'y']).has(key) ? 0 : 1}
                max={new Set(['x', 'width']).has(key) ? width : height}
                onChange={(event) => {
                  setError('');
                  setRegion({ ...region, [key]: Number(event.target.value) });
                }}
              />
            </Field.Root>
          ))}
        </div>
        {error && (
          <p role="alert" {...stylex.props(styles.status)}>
            {error}
          </p>
        )}
        <div {...stylex.props(styles.actions)}>
          <Button variant="ghost" ref={focusCancel} onClick={() => onSelect({ type: 'cancel' })}>
            取消
          </Button>
          <Button variant="secondary" onClick={crop}>
            附加裁剪区域
          </Button>
          <Button onClick={() => onSelect({ type: 'full' })}>附加整张截图</Button>
        </div>
      </div>
    </div>
  );
}
