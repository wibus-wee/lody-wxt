/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Lody's textarea mention listbox retains focus in the multiline input. */
import { colors } from '@lody/ui/tokens/colors.stylex';
import { space, text } from '@lody/ui/tokens/scales.stylex';
import * as stylex from '@stylexjs/stylex';
import type { PointerEvent, RefObject } from 'react';
import { Fragment } from 'react';

import { Icon } from '../../../shared/icons/Icon';
import { Button } from '../../../shared/ui';
import { ActivityStatus } from '../../../shared/ui/ActivityStatus';
import { scoreFuzzy } from '../../../shared/ui/mention-scoring';
import { MentionOption } from '../../../shared/ui/MentionOption';
import { MentionPopup } from '../../../shared/ui/MentionPopup';
import type { ComposerMentionView } from './menu-view';
import { mentionCategories } from './menu-view';
import type { ComposerMentionItem, ComposerMentionKind } from './types';

export type MentionMenuRow =
  | { type: 'category'; id: string; category: ComposerMentionKind }
  | { type: 'item'; id: string; item: ComposerMentionItem };

const styles = stylex.create({
  body: { display: 'flex', alignItems: 'stretch', flexShrink: 0, minWidth: 0, minHeight: 0 },
  column: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
  list: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  text: { display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: 2 },
  textStacked: { paddingBlock: space[1] },
  title: { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
  note: {
    fontSize: text.footnoteSize,
    lineHeight: text.footnoteLeading,
    color: colors.secondaryLabel,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  },
  muted: { color: colors.secondaryLabel },
  highlightedText: { color: colors.label },
  matched: { color: colors.label, fontWeight: 650 },
  emoji: { width: 16, height: 16, flexShrink: 0, lineHeight: 1, fontSize: text.subheadlineSize },
  trailing: {
    flexShrink: 0,
    color: colors.secondaryLabel,
    fontSize: text.captionSize,
    paddingInlineStart: space[2],
  },
  header: { display: 'flex', alignItems: 'center', minHeight: 28, paddingBottom: space[1] },
  group: {
    paddingInline: space[2],
    paddingTop: space[1],
    paddingBottom: space[1],
    color: colors.secondaryLabel,
    fontSize: text.captionSize,
    fontWeight: 500,
  },
  status: {
    padding: space[2],
    fontSize: text.footnoteSize,
    color: colors.secondaryLabel,
    overflowWrap: 'anywhere',
  },
  detail: {
    display: { default: 'flex', '@container mention-menu (max-width: 480px)': 'none' },
    flexDirection: 'column',
    gap: space[1.5],
    width: 280,
    flexShrink: 0,
    padding: space[3],
    borderInlineStartWidth: 1,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colors.separator,
    fontSize: text.footnoteSize,
    minWidth: 0,
  },
  detailTitle: { margin: 0, color: colors.label, fontWeight: 600 },
  paragraph: { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  facts: { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: space[2], margin: 0 },
  fact: { margin: 0, overflowWrap: 'anywhere' },
  footer: {
    flexShrink: 0,
    display: { default: 'flex', '@media (pointer: coarse)': 'none' },
    flexWrap: 'wrap',
    gap: space[2],
    paddingInline: space[2],
    paddingTop: space[1.5],
    paddingBottom: space[1],
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors.separator,
    color: colors.secondaryLabel,
    fontSize: text.captionSize,
  },
});

// Exact pointer policy from ui/mention/mention-item: keep the input focused for mouse and touch.
function keepComposerFocus(event: PointerEvent) {
  const target = event.target;
  if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId))
    target.releasePointerCapture(event.pointerId);
  if (event.button === 0 && !event.ctrlKey) event.preventDefault();
}

function MatchedTitle({
  label,
  term,
  highlighted,
}: {
  label: string;
  term: string;
  highlighted: boolean;
}) {
  const query = term.slice(term.lastIndexOf('/') + 1);
  const [score, positions] = query
    ? scoreFuzzy(label, query, query.toLocaleLowerCase(), true)
    : [0, []];
  if (!score || !positions.length) return label;
  const lit = new Set(positions);
  const runs: { text: string; matched: boolean }[] = [];
  for (let index = 0; index < label.length; index++) {
    const matched = lit.has(index);
    const last = runs.at(-1);
    if (last?.matched === matched) last.text += label[index];
    else runs.push({ text: label[index] ?? '', matched });
  }
  return (
    <span {...stylex.props(styles.muted, highlighted && styles.highlightedText)}>
      {runs.map((run, index) => (
        <span key={index} {...stylex.props(run.matched && styles.matched)}>
          {run.text}
        </span>
      ))}
    </span>
  );
}

export function ComposerMentionMenu({
  anchor,
  listId,
  rows,
  selected,
  loading,
  preparing,
  retrying = false,
  error,
  onClose,
  onSelect,
  onHighlight,
  onRetry,
  view,
  onBack,
}: {
  anchor: RefObject<HTMLDivElement | null>;
  listId: string;
  rows: readonly MentionMenuRow[];
  selected: number;
  loading: boolean;
  preparing: boolean;
  retrying?: boolean;
  error: string;
  onClose: () => void;
  onSelect: (row: MentionMenuRow) => void;
  onHighlight: (index: number) => void;
  onRetry: () => void;
  view?: ComposerMentionView | null;
  onBack?: () => void;
}) {
  const highlighted = rows[selected];
  const selectedItem = highlighted?.type === 'item' ? highlighted.item : null;
  const detail = selectedItem?.detail;
  const category = view?.category ? mentionCategories[view.category] : null;
  return (
    <MentionPopup anchorRef={anchor} onClose={onClose}>
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.column)}>
          {category && (
            <div {...stylex.props(styles.header)}>
              {view?.back ? (
                <Button
                  variant="ghost"
                  size="small"
                  aria-label={`${category.label}，返回全部分类`}
                  onPointerDown={keepComposerFocus}
                  onClick={onBack}
                >
                  <span aria-hidden="true">‹</span>
                  {category.label}
                </Button>
              ) : (
                <span {...stylex.props(styles.group)}>{category.label}</span>
              )}
            </div>
          )}
          <div
            id={listId}
            role="listbox"
            aria-label="提及与命令"
            aria-busy={loading || preparing}
            {...stylex.props(styles.list)}
          >
            {rows.map((row, index) => {
              const kind = row.type === 'category' ? row.category : row.item.kind;
              const definition = mentionCategories[kind];
              const item = row.type === 'item' ? row.item : undefined;
              const previous = rows[index - 1];
              const heading =
                item &&
                view?.level === 'aggregate' &&
                !view.ranked &&
                (previous?.type !== 'item' || previous.item.kind !== kind);
              const label = item
                ? item.kind === 'shortcut'
                  ? `/${item.label}`
                  : item.label
                : definition.label;
              return (
                <Fragment key={row.id}>
                  {heading && (
                    <div role="presentation" {...stylex.props(styles.group)}>
                      {definition.label}
                    </div>
                  )}
                  <MentionOption
                    id={`${listId}-${index}`}
                    aria-label={!item ? definition.label : undefined}
                    aria-describedby={
                      !item && definition.trigger ? `${listId}-${index}-hint` : undefined
                    }
                    highlighted={index === selected}
                    disabled={Boolean(item?.disabledReason) || preparing}
                    onHighlight={() => onHighlight(index)}
                    onChoose={() => onSelect(row)}
                  >
                    {item?.iconEmoji ? (
                      <span aria-hidden="true" {...stylex.props(styles.emoji)}>
                        {item.iconEmoji}
                      </span>
                    ) : (
                      <Icon name={definition.icon} size={16} />
                    )}
                    <span
                      {...stylex.props(
                        styles.text,
                        Boolean(item && (item.disabledReason || item.description)) &&
                          styles.textStacked,
                      )}
                    >
                      <span {...stylex.props(styles.title)}>
                        <MatchedTitle
                          label={label}
                          term={view?.term ?? ''}
                          highlighted={index === selected}
                        />
                      </span>
                      {item && (item.disabledReason || item.description) && (
                        <span
                          {...stylex.props(
                            styles.note,
                            index === selected && styles.highlightedText,
                          )}
                        >
                          {item.disabledReason ?? item.description}
                        </span>
                      )}
                    </span>
                    {!item && definition.trigger && (
                      <span
                        id={`${listId}-${index}-hint`}
                        {...stylex.props(
                          styles.trailing,
                          index === selected && styles.highlightedText,
                        )}
                      >
                        <span className="sr-only">也可输入 </span>
                        {definition.trigger}
                      </span>
                    )}
                    {item && view?.ranked && (
                      <span
                        {...stylex.props(
                          styles.trailing,
                          index === selected && styles.highlightedText,
                        )}
                      >
                        {definition.label}
                      </span>
                    )}
                    {!item && <span aria-hidden="true">›</span>}
                  </MentionOption>
                </Fragment>
              );
            })}
          </div>
          {(loading || preparing) && (
            <div {...stylex.props(styles.status)}>
              <ActivityStatus busy>
                {preparing && !retrying ? '正在插入' : '正在读取'}
              </ActivityStatus>
            </div>
          )}
          {error && (
            <div {...stylex.props(styles.status)}>
              <p role="alert">{error}</p>
              <Button
                variant="ghost"
                size="small"
                onPointerDown={keepComposerFocus}
                onClick={onRetry}
              >
                重新读取
              </Button>
            </div>
          )}
          {!loading && !preparing && !error && !rows.length && (
            <output {...stylex.props(styles.status)}>
              {view?.term ? `没有匹配“${view.term}”的项目` : '没有可用的项目'}
            </output>
          )}
        </div>
        {detail && (
          <aside aria-label="提及详情" {...stylex.props(styles.detail)}>
            <p {...stylex.props(styles.detailTitle)}>{detail.title ?? selectedItem?.label}</p>
            {detail.meta?.length ? (
              <p {...stylex.props(styles.paragraph, styles.muted)}>{detail.meta.join(' · ')}</p>
            ) : null}
            {detail.description && <p {...stylex.props(styles.paragraph)}>{detail.description}</p>}
            {detail.rows?.length ? (
              <dl {...stylex.props(styles.facts)}>
                {detail.rows.map((row) => (
                  <Fragment key={row.label}>
                    <dt {...stylex.props(styles.muted)}>{row.label}</dt>
                    <dd {...stylex.props(styles.fact)}>{row.value}</dd>
                  </Fragment>
                ))}
              </dl>
            ) : null}
          </aside>
        )}
      </div>
      <div {...stylex.props(styles.footer)} aria-hidden="true">
        <span>↑↓ 选择</span>
        <span>{view?.level === 'categories' ? '→ 进入' : '↵ / Tab 插入'}</span>
        {view?.back && <span>← 返回</span>}
        <span>Esc 关闭</span>
      </div>
    </MentionPopup>
  );
}
