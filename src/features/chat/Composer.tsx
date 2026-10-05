import * as stylex from '@stylexjs/stylex';
import type { KeyboardEvent, ReactNode } from 'react';
import { useRef } from 'react';

import { text } from '../../../vendor/lody/packages/ui/src/tokens/scales.stylex';
import { Field, Textarea } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';
import type { PageContext } from '../connection/client';
import { ComposerMentionMenu } from './mentions/ComposerMentionMenu';
import { COMPOSER_MAX_LENGTH } from './mentions/core';
import type { ComposerMentionRange, ComposerMentionSource } from './mentions/types';
import { useComposerMentions } from './mentions/use-composer-mentions';

const styles = stylex.create({
  surface: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '12px 10px 8px',
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
    minHeight: 56,
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
  action: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
    marginInlineStart: 'auto',
  },
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
  onFiles,
  mentionSource,
  mentionRanges,
  onMentionCommit,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  attachments: ReactNode;
  attachmentAction: ReactNode;
  configuration: ReactNode;
  primaryAction: ReactNode;
  onFiles?: ((files: File[]) => void) | undefined;
  mentionSource?: ComposerMentionSource | undefined;
  mentionRanges?: readonly ComposerMentionRange[] | undefined;
  onMentionCommit?:
    | ((text: string, ranges?: readonly ComposerMentionRange[], context?: PageContext) => void)
    | undefined;
}) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const mentions = useComposerMentions({
    source: mentionSource,
    ranges: mentionRanges,
    value,
    disabled,
    inputRef: promptRef,
    onCommit: onMentionCommit ?? onChange,
  });
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Frame clicks focus the keyboard-accessible textarea; the frame is not another control.
    <div
      ref={frameRef}
      {...stylex.props(styles.surface)}
      data-testid="composer"
      data-mention-frame=""
      onDragOver={(event) => {
        if (!disabled && onFiles && event.dataTransfer.types.includes('Files'))
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (disabled || !onFiles || !event.dataTransfer.files.length) return;
        event.preventDefault();
        onFiles(Array.from(event.dataTransfer.files));
      }}
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
      {mentions.open && (
        <ComposerMentionMenu
          anchor={frameRef}
          listId={mentions.listId}
          rows={mentions.rows}
          view={mentions.view}
          onBack={mentions.back}
          selected={mentions.selected}
          loading={mentions.loading}
          preparing={mentions.preparing}
          retrying={mentions.retrying}
          error={mentions.error}
          onClose={mentions.close}
          onSelect={mentions.select}
          onHighlight={mentions.setSelected}
          onRetry={mentions.retry}
        />
      )}
      <Field.Root disabled={disabled}>
        <Field.Label className="sr-only">消息</Field.Label>
        <Textarea
          ref={promptRef}
          {...stylex.props(styles.prompt)}
          appearance="bare"
          resize="none"
          rows={2}
          maxLength={COMPOSER_MAX_LENGTH}
          data-keyboard-nav="composer"
          placeholder="问点什么…"
          aria-description={mentionSource ? '输入 / 使用命令，@ 添加提及，$ 使用技能。' : undefined}
          aria-autocomplete={mentionSource ? 'list' : undefined}
          aria-controls={mentions.open ? mentions.listId : undefined}
          aria-activedescendant={
            mentions.open && mentions.rows[mentions.selected]
              ? `${mentions.listId}-${mentions.selected}`
              : undefined
          }
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            if (!composingRef.current) mentions.inspect(event.target);
          }}
          onSelect={(event) => {
            if (!composingRef.current) mentions.inspect(event.currentTarget);
          }}
          onPaste={(event) => {
            if (disabled || !onFiles || !event.clipboardData.files.length) return;
            event.preventDefault();
            onFiles(Array.from(event.clipboardData.files));
            const pasted = event.clipboardData.getData('text/plain');
            if (pasted) {
              const start = event.currentTarget.selectionStart;
              const end = event.currentTarget.selectionEnd;
              onChange(
                (value.slice(0, start) + pasted + value.slice(end)).slice(0, COMPOSER_MAX_LENGTH),
              );
            }
          }}
          onCompositionStart={() => {
            composingRef.current = true;
            mentions.close();
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            mentions.inspect(event.currentTarget, true);
          }}
          onKeyDown={(event) => {
            if (!composingRef.current && !mentions.keyDown(event)) onKeyDown(event);
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
