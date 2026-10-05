import { useLayoutEffect, useRef, useState } from 'react';
import * as v from 'valibot';

const savedScroll = v.object({
  top: v.pipe(v.number(), v.finite(), v.minValue(0)),
  following: v.boolean(),
});

function readPosition(key?: string) {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(`lody:scroll:${key}`);
    return raw ? v.parse(savedScroll, JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function selectionWithin(viewport: HTMLElement) {
  const selection = window.getSelection();
  return Boolean(
    selection &&
    !selection.isCollapsed &&
    selection.anchorNode &&
    selection.focusNode &&
    viewport.contains(selection.anchorNode) &&
    viewport.contains(selection.focusNode),
  );
}

const scrollableOverflow = /auto|scroll/;

function innerScroller(target: EventTarget | null, viewport: HTMLElement, delta: number) {
  let element = target instanceof Element ? target : null;
  while (element && element !== viewport) {
    if (
      scrollableOverflow.test(getComputedStyle(element).overflowY) &&
      (delta < 0
        ? element.scrollTop > 0
        : element.scrollHeight - element.clientHeight - element.scrollTop > 1)
    )
      return true;
    element = element.parentElement;
  }
  return false;
}

/** Follow intent is independent of whether the latest content is currently visible. */
export function useTranscriptScroll(key: string | undefined, ready: boolean) {
  const viewportRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const jumpRef = useRef(() => {});
  const [showLatest, setShowLatest] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content || !ready) return;
    const saved = readPosition(key);
    let following = saved?.following ?? true;
    let restoreTop = saved && !following ? saved.top : null;
    const geometry = () => ({
      top: viewport.scrollTop,
      height: viewport.clientHeight,
      total: viewport.scrollHeight,
    });
    let previous = geometry();
    const update = (scrolled = false) => {
      if (!viewport.clientHeight || !viewport.getClientRects().length) return false;
      const current = geometry();
      const changedLayout = current.height !== previous.height || current.total !== previous.total;
      const movement = current.top - previous.top;
      const gap = Math.max(0, current.total - current.height - current.top);
      // Own writes update `previous` immediately. Layout clamping is not reader input.
      if (scrolled && !changedLayout) {
        if (movement < -0.5) {
          following = false;
          restoreTop = null;
        } else if (movement > 0.5 && gap <= 2) {
          following = true;
          restoreTop = null;
        }
      }
      if (following && !selectionWithin(viewport)) {
        viewport.scrollTop = Math.max(0, current.total - current.height);
      } else if (restoreTop !== null) {
        viewport.scrollTop = restoreTop;
        if (current.total - current.height >= restoreTop) restoreTop = null;
      }
      previous = geometry();
      return previous.total - previous.height - previous.top > 8;
    };
    const pause = () => {
      following = false;
      restoreTop = null;
      update();
    };
    const onScroll = () => setShowLatest(update(true));
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && !innerScroller(event.target, viewport, event.deltaY)) pause();
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !(event.target instanceof Element) ||
        event.target.closest('input, textarea, [contenteditable="true"], [role="textbox"]')
      )
        return;
      if (
        ['ArrowUp', 'PageUp', 'Home'].includes(event.key) &&
        !innerScroller(event.target, viewport, -1)
      )
        pause();
    };
    const onInspect = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('button[aria-expanded="false"]:not([aria-haspopup]):not(:disabled)')
      )
        pause();
    };
    const onSelect = () => {
      if (selectionWithin(viewport)) pause();
    };
    let touchY: number | undefined;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      const next = event.touches[0]?.clientY;
      if (next === undefined || touchY === undefined) return;
      const delta = touchY - next;
      touchY = next;
      if (delta < 0 && !innerScroller(event.target, viewport, delta)) pause();
    };
    const jump = () => {
      window.getSelection()?.removeAllRanges();
      following = true;
      restoreTop = null;
      setShowLatest(update());
      viewport.focus({ preventScroll: true });
    };
    jumpRef.current = jump;
    const save = () => {
      if (!key) return;
      try {
        sessionStorage.setItem(
          `lody:scroll:${key}`,
          JSON.stringify({ top: restoreTop ?? viewport.scrollTop, following }),
        );
      } catch {
        /* Presentation persistence must not interrupt conversation delivery. */
      }
    };
    update();
    const resize = new ResizeObserver(() => setShowLatest(update()));
    resize.observe(viewport);
    resize.observe(content);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('wheel', onWheel, { passive: true });
    viewport.addEventListener('keydown', onKey);
    viewport.addEventListener('click', onInspect, true);
    viewport.addEventListener('pointerup', onSelect);
    viewport.addEventListener('keyup', onSelect);
    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('pagehide', save);
    return () => {
      save();
      resize.disconnect();
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('keydown', onKey);
      viewport.removeEventListener('click', onInspect, true);
      viewport.removeEventListener('pointerup', onSelect);
      viewport.removeEventListener('keyup', onSelect);
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('pagehide', save);
      if (jumpRef.current === jump) jumpRef.current = () => {};
    };
  }, [key, ready]);

  return {
    viewportRef,
    contentRef,
    showLatest: ready && showLatest,
    jumpToLatest: () => jumpRef.current(),
  };
}
