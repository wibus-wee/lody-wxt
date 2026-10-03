import { colors } from '@lody/ui/tokens/colors.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { Icon } from '../icons/Icon';
import { menuStyles } from './menu';

const styles = stylex.create({
  input: { '::placeholder': { color: colors.secondaryLabel, opacity: 1 } },
  shell: { minWidth: 0, marginInline: 0, marginTop: 0, paddingBlock: 0, borderWidth: 0 },
});

// Adapted from Lody packages/components/src/ui/menu.tsx; keep typing outside menu typeahead.
export function MenuSearchInput({
  value,
  onValueChange,
  onSubmit,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const latestRef = useRef({ value, onValueChange });
  useLayoutEffect(() => {
    latestRef.current = { value, onValueChange };
  }, [value, onValueChange]);
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const content = inputRef.current?.closest<HTMLElement>('[data-lody-menu-content]');
    if (!content) return;
    const claimTyping = (event: KeyboardEvent) => {
      if (
        event.target === inputRef.current ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const { value: current, onValueChange: change } = latestRef.current;
      if (event.key.length === 1) change(current + event.key);
      else if (event.key === 'Backspace') change(current.slice(0, -1));
      else return;
      event.preventDefault();
      event.stopPropagation();
      inputRef.current?.focus();
    };
    content.addEventListener('keydown', claimTyping);
    return () => content.removeEventListener('keydown', claimTyping);
  }, []);
  return (
    // The contained input owns keyboard focus; the shell only expands its pointer target.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <fieldset
      aria-label="模型搜索"
      {...stylex.props(menuStyles.searchShell, styles.shell)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        inputRef.current?.focus();
      }}
    >
      <Icon name="search" size={14} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        data-lody-menu-search=""
        aria-label="搜索模型"
        placeholder="搜索模型"
        {...stylex.props(menuStyles.searchInput, styles.input)}
        onChange={(event) => onValueChange(event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const items = Array.from(
              event.currentTarget
                .closest('[data-lody-menu-content]')
                ?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not([data-disabled])') ??
                [],
            );
            const target = event.key === 'ArrowDown' ? items[0] : items.at(-1);
            if (target) {
              event.preventDefault();
              event.stopPropagation();
              target.focus();
            }
            return;
          }
          if (event.key === 'Escape' || event.key === 'Tab') return;
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit();
          }
          event.stopPropagation();
        }}
      />
    </fieldset>
  );
}
