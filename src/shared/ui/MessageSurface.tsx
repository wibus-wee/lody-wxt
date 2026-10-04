import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { Icon } from '../icons/Icon';
import { ActivityStatus } from './ActivityStatus';
import { AssistantTurn } from './conversation/AssistantTurn';
import type { MessageContent } from './conversation/content';
import { ConversationContentContext } from './conversation/content-actions-context';
import type { ConversationContentActions } from './conversation/specialized-content';
import { Button, Tooltip } from './index';
import { messageSurface as styles } from './message.stylex';
import { useCopyFeedback } from './use-copy-feedback';

export function MessageSurface({
  role,
  text,
  status,
  timestamp = '',
  duration = '',
  attachments,
  configuration,
  content,
  actions: messageActions,
  contentActions,
}: {
  role: 'user' | 'agent';
  text: string;
  status: 'complete' | 'streaming' | 'stopped' | 'failed';
  timestamp?: string;
  duration?: string;
  attachments?: ReactNode;
  configuration?: ReactNode;
  actions?: ReactNode;
  contentActions?: ConversationContentActions | undefined;
  content?: readonly MessageContent[] | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const { copied, error, copy } = useCopyFeedback();
  const user = role === 'user';
  const lastContent = content?.at(-1);
  const liveProcess =
    lastContent?.type === 'thought' ||
    (lastContent?.type === 'tool_call' &&
      lastContent.kind !== 'switch_mode' &&
      lastContent.activityKind === undefined);
  const lineSlice = text.split('\n').slice(0, 10).join('\n').slice(0, 900);
  const long = lineSlice.length < text.length;
  const showFull = !long || expanded;
  const copyText =
    !user && content
      ? content
          .map((item) =>
            item.type === 'text' ? item.text : item.type === 'proposed_plan' ? item.markdown : '',
          )
          .filter(Boolean)
          .join('\n\n')
      : text;
  const copyButton = copyText.trim() ? (
    <Tooltip.Root>
      <Tooltip.Trigger
        delay={500}
        render={
          <Button
            type="button"
            variant="ghost"
            icon
            aria-label="复制消息"
            data-copied={copied || undefined}
            {...stylex.props(styles.action)}
            onClick={() => void copy(copyText)}
          >
            <Icon name={copied ? 'check' : 'copy'} size={14} />
          </Button>
        }
      />
      <Tooltip.Content>{copied ? '已复制' : user ? '复制消息' : '复制回复'}</Tooltip.Content>
    </Tooltip.Root>
  ) : null;
  const actions = (
    <div {...stylex.props(styles.actions)} data-message-actions="">
      <div {...stylex.props(styles.buttons)}>
        {copyButton}
        {messageActions}
        {!user && configuration}
      </div>
      {!user && status !== 'streaming' && timestamp && <span>{timestamp}</span>}
      {!user &&
        status !== 'streaming' &&
        !content?.some((item) => item.type === 'tool_call') &&
        duration && <span>{duration}</span>}
    </div>
  );
  return (
    <article
      {...stylex.props(styles.turn, user && styles.userRow)}
      aria-label={user ? '你的消息' : 'Agent 消息'}
    >
      {user ? (
        <>
          <span {...stylex.props(styles.avatar)}>
            <Icon name="user" size={24} />
          </span>
          <div {...stylex.props(styles.userStack)}>
            <div {...stylex.props(styles.metadata)} data-testid="user-message-metadata">
              <span {...stylex.props(styles.delivered)} title="已送达">
                <Icon name="delivered" size={14} />
              </span>
              {timestamp && <span>{timestamp}</span>}
            </div>
            {attachments}
            <div {...stylex.props(styles.bubble)}>
              <p
                {...stylex.props(styles.userText, styles.body, !showFull && styles.clipped)}
                data-user-message-text=""
              >
                {showFull ? text : lineSlice}
              </p>
              {long && (
                <div {...stylex.props(styles.expand)}>
                  <Button
                    variant="ghost"
                    size="small"
                    {...stylex.props(styles.expandButton)}
                    aria-expanded={expanded}
                    onClick={() => setExpanded(!expanded)}
                  >
                    <span {...stylex.props(styles.expandText)}>
                      {expanded ? '收起' : '展开全部'}
                    </span>
                  </Button>
                </div>
              )}
            </div>
            {actions}
            {error && <output {...stylex.props(styles.error)}>{error}</output>}
          </div>
        </>
      ) : (
        <div {...stylex.props(styles.rail)}>
          <ConversationContentContext value={contentActions ?? {}}>
            <AssistantTurn
              items={content ?? [{ type: 'text', text }]}
              status={status}
              duration={duration}
            />
          </ConversationContentContext>
          {attachments}
          {status === 'streaming' && !liveProcess && (
            <div data-message-live="">
              <ActivityStatus busy>生成中</ActivityStatus>
            </div>
          )}
          {status === 'stopped' && <div {...stylex.props(styles.status)}>已停止 · 内容已保留</div>}
          {status === 'failed' && (
            <div {...stylex.props(styles.status, styles.error)}>回复未完成</div>
          )}
          {actions}
          {error && <output {...stylex.props(styles.error)}>{error}</output>}
        </div>
      )}
    </article>
  );
}
