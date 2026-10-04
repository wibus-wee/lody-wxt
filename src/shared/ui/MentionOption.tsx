/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events -- Port of Lody's MentionItem: the textarea owns option keyboard navigation and retains its caret. */
import * as stylex from '@stylexjs/stylex';
import type { ComponentPropsWithoutRef } from 'react';

import { mentionSurface } from './mention-surface';

type Props = Omit<
  ComponentPropsWithoutRef<'div'>,
  'onClick' | 'onPointerDown' | 'onPointerMove' | 'role' | 'className'
> & {
  highlighted: boolean;
  disabled: boolean;
  onChoose: () => void;
  onHighlight: () => void;
};

/**
 * Lody ui/mention's option primitive and skin. The row owns its StyleX merge;
 * passing these classes to Button leaves its opaque variant/reset in the cascade.
 */
export function MentionOption({
  highlighted,
  disabled,
  onChoose,
  onHighlight,
  children,
  ...props
}: Props) {
  return (
    <div
      {...props}
      role="option"
      tabIndex={-1}
      data-slot="mention-item"
      data-mention-item=""
      data-highlighted={highlighted ? '' : undefined}
      aria-selected={highlighted}
      aria-disabled={disabled}
      {...stylex.props(mentionSurface.item, highlighted && mentionSurface.itemHighlighted)}
      onPointerDown={(event) => {
        if (disabled) return;
        const target = event.target;
        if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId))
          target.releasePointerCapture(event.pointerId);
        if (event.button === 0 && !event.ctrlKey) event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (!disabled && event.pointerType !== 'touch') onHighlight();
      }}
      onClick={() => {
        if (!disabled) onChoose();
      }}
    >
      {children}
    </div>
  );
}
