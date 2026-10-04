/* oxlint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- The labelled overflow region is keyboard reachable for native scrolling (WCAG 2.1.1); Escape restores the composer, while options retain their textarea navigation. */
import { colors, shadow } from '@lody/ui/tokens/colors.stylex';
import { corner, focus } from '@lody/ui/tokens/scales.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { mentionSurface } from './mention-surface';

const styles = stylex.create({
  popup: {
    zIndex: 60,
    WebkitOverflowScrolling: 'touch',
    minWidth: 0,
    boxSizing: 'border-box',
    containerName: 'mention-menu',
    containerType: 'inline-size',
  },
  fixed: { position: 'fixed' },
  absolute: { position: 'absolute' },
  content: {
    overflowY: 'auto',
    maxHeight: 'inherit',
    overscrollBehavior: 'contain',
    cornerShape: { default: corner.shape, ':focus-visible': corner.round },
    boxShadow: {
      default: shadow.popover,
      ':focus-visible': `0 0 0 ${focus.ringWidth} ${colors.accent}, ${shadow.popover}`,
    },
  },
  geometry: (left: number, top: number, width: number, maxHeight: number) => ({
    left,
    top,
    width,
    maxHeight,
  }),
  above: { transform: 'translateY(-100%)' },
});

interface Geometry {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  above: boolean;
  layer: HTMLElement;
}

/** Port of Lody's composer anchor and mobile dock; one scroller, no focus trap. */
export function MentionPopup({
  anchorRef,
  children,
  onClose,
}: {
  anchorRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  onClose: () => void;
}) {
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    let live = true;
    let side: boolean | undefined;
    const layer =
      anchor.closest<HTMLElement>('[data-vaul-drawer], [data-lody-dialog-content]') ??
      document.body;
    const measure = () => {
      if (!live) return;
      const rect = anchor.getBoundingClientRect();
      const modalRect = layer === document.body ? null : layer.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = Math.min(
        viewportTop + (viewport?.height ?? window.innerHeight),
        modalRect?.bottom ?? Infinity,
      );
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
      const mobile = window.matchMedia('(max-width: 639px)').matches;
      const topInset = mobile
        ? Math.max(viewportTop + 56, (modalRect?.top ?? 0) + 8)
        : Math.max(viewportTop, modalRect?.top ?? 0) + 16;
      const roomAbove = Math.max(0, rect.top - topInset);
      const roomBelow = Math.max(0, viewportBottom - rect.bottom - 16);
      // The original composer picks its side once; navigating levels never flips it.
      side ??= mobile || roomAbove >= 360 || roomAbove >= roomBelow;
      const maxHeight = Math.max(
        0,
        Math.min(mobile ? 220 : 320, (side ? roomAbove : roomBelow) - 8),
      );
      const left = mobile
        ? (modalRect?.left ?? viewportLeft) + 8
        : Math.max(rect.left, viewportLeft + 16);
      const right = mobile
        ? (modalRect?.right ?? viewportRight) - 8
        : Math.min(rect.right, viewportRight - 16);
      const next = {
        layer,
        above: side,
        left: left - (modalRect?.left ?? 0),
        top: (side ? rect.top - 8 : rect.bottom + 8) - (modalRect?.top ?? 0),
        width: Math.max(0, right - left),
        maxHeight,
      };
      setGeometry((previous) =>
        previous &&
        Object.keys(next).every(
          (key) => previous[key as keyof Geometry] === next[key as keyof Geometry],
        )
          ? previous
          : next,
      );
    };
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !anchor.contains(event.target) &&
        !popupRef.current?.contains(event.target)
      )
        closeRef.current();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    if (layer !== document.body) observer.observe(layer);
    const frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
    };
  }, [anchorRef]);
  if (!geometry) return null;
  return createPortal(
    <div
      ref={popupRef}
      data-mention-popup=""
      {...stylex.props(
        styles.popup,
        geometry.layer === document.body ? styles.fixed : styles.absolute,
        geometry.above && styles.above,
        styles.geometry(geometry.left, geometry.top, geometry.width, geometry.maxHeight),
      )}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <section
        data-mention-scroll=""
        aria-label="提及选项"
        tabIndex={0}
        {...stylex.props(mentionSurface.surface, styles.content)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          closeRef.current();
          anchorRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
        }}
      >
        {children}
      </section>
    </div>,
    geometry.layer,
  );
}
