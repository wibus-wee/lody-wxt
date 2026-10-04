import { colors } from '@lody/ui/tokens/colors.stylex';
import { text } from '@lody/ui/tokens/scales.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { Icon } from '../../shared/icons/Icon';
import { Button, Popover } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';
import type { ContextFreshness } from './capture';
import { capturePage, readContextFreshness } from './capture';
import type { PageContext } from './model';
import { githubRepository } from './model';
import { seekCapturedVideo } from './video';

const timestamp = /^\[(\d+):(\d{2})\] (.*)$/;

const styles = stylex.create({
  strip: {
    display: 'flex',
    gap: 8,
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    flexShrink: 0,
  },
  draft: { overflowX: 'auto', paddingBottom: 4 },
  message: { flexWrap: 'wrap', justifyContent: 'end' },
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
  metadata: {
    fontSize: text.captionSize,
    color: colors.secondaryLabel,
    margin: '6px 0',
    overflowWrap: 'anywhere',
  },
  actions: { display: 'flex', gap: 8, marginTop: 8 },
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
  onRefresh,
  layout = 'draft',
}: {
  layout?: 'draft' | 'message';
  contexts: PageContext[];
  remove?: ((id: string) => void) | undefined;
  onRefresh?: ((previousId: string, context: PageContext) => void) | undefined;
}) {
  if (!contexts.length) return null;
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Attachments form an accessible group.
    <div {...stylex.props(styles.strip, styles[layout])} role="group" aria-label="已附加的网页资料">
      {contexts.map((context) => (
        <ContextCard key={context.id} context={context} remove={remove} onRefresh={onRefresh} />
      ))}
    </div>
  );
}

function ContextCard({
  context,
  remove,
  onRefresh,
}: {
  context: PageContext;
  remove?: ((id: string) => void) | undefined;
  onRefresh?: ((previousId: string, context: PageContext) => void) | undefined;
}) {
  const [freshness, setFreshness] = useState<ContextFreshness>('unknown');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    if (!onRefresh || context.tabId === undefined || context.kind === 'link') return;
    setRefreshing(true);
    setError('');
    try {
      const next = await capturePage(context.kind, {
        tabId: context.tabId,
        frameId: context.frameId ?? 0,
      });
      onRefresh(context.id, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法重新读取来源。');
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <div {...stylex.props(styles.item)} data-testid="context-card">
      <Popover.Root
        modal
        onOpenChange={(open) => {
          if (open && onRefresh) void readContextFreshness(context).then(setFreshness);
        }}
      >
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
          {context.truncated && <span {...stylex.props(styles.type)}>部分</span>}
        </Popover.Trigger>
        <Popover.Content side="top" align="start">
          <Popover.Header>
            <Popover.Title>{context.title}</Popover.Title>
            <Popover.Description>
              {context.kind === 'link'
                ? '链接地址 · 尚未读取网页'
                : `${context.kind === 'selection' ? '选中文字' : '网页正文'} · ${context.text.length} 字符`}
            </Popover.Description>
          </Popover.Header>
          <a {...stylex.props(styles.source)} href={context.url} target="_blank" rel="noreferrer">
            {githubRepository(context.url) ?? context.url}
          </a>
          {context.capturedAt && (
            <p {...stylex.props(styles.metadata)}>
              采集于 {new Date(context.capturedAt).toLocaleString()}
            </p>
          )}
          {context.truncated && (
            <p {...stylex.props(styles.metadata)}>
              正文已截断：附加了前 {context.text.length} / {context.sourceLength ?? '未知'} 字符。
            </p>
          )}
          {context.kind === 'page' && (
            <p {...stylex.props(styles.metadata)}>
              可见正文、开放 Shadow DOM 和可访问的同源 frame；不包含跨来源 frame、隐藏内容或表单。
            </p>
          )}
          {freshness === 'changed' && (
            <output {...stylex.props(styles.metadata)}>页面已变化，当前保留原始快照。</output>
          )}
          {freshness === 'closed' && (
            <output {...stylex.props(styles.metadata)}>来源标签页已关闭，快照仍可发送。</output>
          )}
          {context.title.includes(' · 字幕 ') ? (
            <div {...stylex.props(styles.preview)}>
              {Array.from(new Set(context.text.split('\n'))).map((line) => {
                const match = timestamp.exec(line);
                if (!match) return <p key={line}>{line}</p>;
                return (
                  <p key={line}>
                    <Button
                      size="mini"
                      variant="ghost"
                      aria-label={`跳转到 ${match[1]} 分 ${match[2]} 秒`}
                      onClick={() => {
                        void seekCapturedVideo(
                          context,
                          Number(match[1]) * 60 + Number(match[2]),
                        ).catch((cause: unknown) =>
                          setError(cause instanceof Error ? cause.message : '无法定位视频。'),
                        );
                      }}
                    >
                      {match[1]}:{match[2]}
                    </Button>{' '}
                    {match[3]}
                  </p>
                );
              })}
            </div>
          ) : (
            <section
              {...stylex.props(styles.preview)}
              aria-label="资料预览"
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The long source preview must scroll by keyboard.
              tabIndex={0}
            >
              <p>{context.text}</p>
            </section>
          )}
          {onRefresh &&
            context.tabId !== undefined &&
            context.kind !== 'link' &&
            freshness !== 'closed' && (
              <div {...stylex.props(styles.actions)}>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={refreshing}
                  onClick={() => void refresh()}
                >
                  {refreshing ? '正在读取…' : '更新快照'}
                </Button>
              </div>
            )}
          <Popover.Close render={<Button size="small" variant="ghost" />}>关闭预览</Popover.Close>
          {error && (
            <p role="alert" {...stylex.props(styles.metadata)}>
              {error}
            </p>
          )}
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
  );
}
