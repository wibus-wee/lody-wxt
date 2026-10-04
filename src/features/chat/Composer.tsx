import * as stylex from '@stylexjs/stylex';
import type { KeyboardEvent, ReactNode } from 'react';
import { useRef } from 'react';

import { text } from '../../../vendor/lody/packages/ui/src/tokens/scales.stylex';
import { Field, Textarea } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';

const styles = stylex.create({
  surface: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '6px 8px',
    minWidth: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: composer.border,
    borderRadius: 12,
    backgroundColor: composer.background,
    color: composer.label,
    boxShadow: composer.elevation,
  },
  prompt: {
    display: 'block',
    width: '100%',
    minHeight: 48,
    maxHeight: 'min(200px, 28dvh)',
    fieldSizing: 'content',
    paddingInline: 4,
    paddingBlock: 0,
    fontSize: text.bodySize,
    lineHeight: text.bodyLeading,
    fontWeight: 400,
    color: composer.label,
    '::placeholder': { color: composer.hint, opacity: 1 },
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    paddingTop: 2,
    userSelect: 'none',
  },
  face: {
    display: 'flex',
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    flexWrap: 'nowrap',
    overflow: 'hidden',
    containerType: 'inline-size',
    containerName: 'composer-face',
  },
  action: { display: 'flex', flexShrink: 0, marginInlineStart: 'auto' },
});

export function Composer({
  value,
  disabled,
  onChange,
  onKeyDown,
  attachments,
  attachmentAction,
  configuration,
  primaryAction,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  attachments: ReactNode;
  attachmentAction: ReactNode;
  configuration: ReactNode;
  primaryAction: ReactNode;
}) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Frame clicks focus the keyboard-accessible textarea; the frame is not another control.
    <div
      {...stylex.props(styles.surface)}
      data-testid="composer"
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.currentTarget.contains(event.target) &&
          !event.target.closest('button, a, input, textarea, [role="menuitem"], [role="option"]')
        )
          promptRef.current?.focus({ preventScroll: true });
      }}
    >
      {attachments}
      <Field.Root disabled={disabled}>
        <Field.Label className="sr-only">消息</Field.Label>
        <Textarea
          ref={promptRef}
          {...stylex.props(styles.prompt)}
          appearance="bare"
          resize="none"
          rows={2}
          maxLength={16000}
          data-keyboard-nav="composer"
          placeholder="问点什么…"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(event) => {
            if (!composingRef.current) onKeyDown(event);
          }}
        />
      </Field.Root>
      <div {...stylex.props(styles.footer)}>
        {attachmentAction}
        <div {...stylex.props(styles.face)}>{configuration}</div>
        <div {...stylex.props(styles.action)}>{primaryAction}</div>
      </div>
    </div>
  );
}
