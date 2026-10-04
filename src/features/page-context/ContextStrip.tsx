import { colors } from '@lody/ui/tokens/colors.stylex';
import { text } from '@lody/ui/tokens/scales.stylex';
import * as stylex from '@stylexjs/stylex';

import { Icon } from '../../shared/icons/Icon';
import { Button, Popover } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';
import type { PageContext } from './model';
import { githubRepository } from './model';

const styles = stylex.create({
  strip: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, flexShrink: 0 },
  item: { position: 'relative', maxWidth: '100%', height: 32, flexShrink: 0 },
  tile: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    height: '100%',
    padding: '4px 30px 4px 8px',
    gap: 6,
    textAlign: 'start',
    whiteSpace: 'normal',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: composer.border,
    borderRadius: 8,
    backgroundColor: 'transparent',
    color: composer.label,
    boxShadow: { default: 'none', ':focus-visible': `0 0 0 2px ${colors.accent}` },
  },
  type: { fontSize: text.captionSize, lineHeight: 1, color: composer.hint },
  name: {
    maxWidth: 180,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: text.captionSize,
    lineHeight: text.captionLeading,
    fontWeight: 500,
  },
  remove: { position: 'absolute', top: 4, right: 4 },
  removeButton: { width: 20, height: 20, minWidth: 20, padding: 0 },
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
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Attachments form an accessible group.
    <div {...stylex.props(styles.strip)} role="group" aria-label="已附加的网页资料">
      {contexts.map((context) => (
        <div key={context.id} {...stylex.props(styles.item)} data-testid="context-card">
          <Popover.Root>
            <Popover.Trigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  {...stylex.props(styles.tile)}
                  aria-label={`查看资料 ${context.title}`}
                />
              }
            >
              <span {...stylex.props(styles.type)}>
                <Icon name="page" size={14} />
              </span>
              <span {...stylex.props(styles.name)}>{context.title}</span>
            </Popover.Trigger>
            <Popover.Content side="top" align="start">
              <Popover.Header>
                <Popover.Title>{context.title}</Popover.Title>
                <Popover.Description>
                  {context.kind === 'selection' ? '选中文字' : '网页正文'} · {context.text.length}{' '}
                  字符
                </Popover.Description>
              </Popover.Header>
              <a
                {...stylex.props(styles.source)}
                href={context.url}
                target="_blank"
                rel="noreferrer"
              >
                {githubRepository(context.url) ?? context.url}
              </a>
              <p {...stylex.props(styles.preview)}>{context.text}</p>
            </Popover.Content>
          </Popover.Root>
          {remove && (
            <span {...stylex.props(styles.remove)}>
              <Button
                {...stylex.props(styles.removeButton)}
                variant="ghost"
                size="mini"
                icon
                type="button"
                aria-label={`移除 ${context.title}`}
                onClick={() => remove(context.id)}
              >
                <Icon name="close" size={12} />
              </Button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
