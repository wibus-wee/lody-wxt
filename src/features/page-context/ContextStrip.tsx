import { colors } from '@lody/ui/tokens/colors.stylex';
import { text } from '@lody/ui/tokens/scales.stylex';
import * as stylex from '@stylexjs/stylex';

import { Icon } from '../../shared/icons/Icon';
import { Popover } from '../../shared/ui';
import { composerSurface } from '../../shared/ui/composer';
import { composer } from '../../shared/ui/composer.stylex';
import type { PageContext } from './model';

const styles = stylex.create({
  strip: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, flexShrink: 0 },
  item: { position: 'relative', width: 80, height: 80, flexShrink: 0 },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'start',
    justifyContent: 'space-between',
    width: '100%',
    height: '100%',
    padding: 8,
    gap: 4,
    textAlign: 'start',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: composer.border,
    borderRadius: 12,
    backgroundColor: 'transparent',
    color: composer.label,
    cursor: 'pointer',
    boxShadow: { default: 'none', ':focus-visible': `0 0 0 2px ${colors.accent}` },
    outlineStyle: 'none',
  },
  type: { fontSize: text.captionSize, lineHeight: 1, color: composer.hint },
  name: {
    width: '100%',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    fontSize: text.captionSize,
    lineHeight: text.captionLeading,
    fontWeight: 500,
  },
  remove: { position: 'absolute', top: 1, right: 1 },
  removeButton: { width: 20, height: 20, minWidth: 20, padding: 0, justifyContent: 'center' },
  source: { overflowWrap: 'anywhere', fontSize: text.captionSize },
  preview: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    maxHeight: 240,
    overflowY: 'auto',
    margin: '8px 0 0',
    fontSize: text.footnoteSize,
    lineHeight: text.footnoteLeading,
  },
});

export function ContextStrip({
  contexts,
  remove,
}: {
  contexts: PageContext[];
  remove?: ((id: string) => void) | undefined;
}) {
  if (!contexts.length) return null;
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Attachment buttons form a group, not a fieldset of form inputs.
    <div {...stylex.props(styles.strip)} role="group" aria-label="已附加的网页资料">
      {contexts.map((context) => (
        <div key={context.id} {...stylex.props(styles.item)} data-testid="context-card">
          <Popover.Root>
            <Popover.Trigger
              render={
                <button
                  type="button"
                  {...stylex.props(styles.tile)}
                  aria-label={`查看资料 ${context.title}`}
                />
              }
            >
              <span {...stylex.props(styles.type)}>
                {context.kind === 'selection' ? 'TEXT' : 'PAGE'}
              </span>
              <span {...stylex.props(styles.name)}>{context.title}</span>
            </Popover.Trigger>
            <Popover.Content side="top" align="start">
              <Popover.Header>
                <Popover.Title>{context.title}</Popover.Title>
                <Popover.Description>
                  {context.kind === 'selection' ? '选中文字' : '网页正文'} · 非可信资料 ·{' '}
                  {context.text.length} 字符
                </Popover.Description>
              </Popover.Header>
              <a
                {...stylex.props(styles.source)}
                href={context.url}
                target="_blank"
                rel="noreferrer"
              >
                {context.url}
              </a>
              <p {...stylex.props(styles.preview)}>{context.text}</p>
            </Popover.Content>
          </Popover.Root>
          {remove && (
            <span {...stylex.props(styles.remove)}>
              <button
                {...stylex.props(composerSurface.trigger, styles.removeButton)}
                type="button"
                aria-label={`移除 ${context.title}`}
                onClick={() => remove(context.id)}
              >
                <Icon name="close" size={12} />
              </button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
