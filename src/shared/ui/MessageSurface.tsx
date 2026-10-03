import * as stylex from '@stylexjs/stylex';
import { useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';

import { Icon } from '../icons/Icon';
import { Button, Tooltip } from './index';
import { messageSurface as styles } from './message.stylex';
import { MessageMarkdown } from './MessageMarkdown';
import { useCopyFeedback } from './use-copy-feedback';

export interface MessageActivity {
  id: string;
  title: string;
  command?: string | undefined;
  output?: string | undefined;
  status: 'running' | 'complete' | 'failed';
}

function Disclosure({
  label,
  open,
  onClick,
  header = false,
  controls,
}: {
  label: string;
  open: boolean;
  onClick: () => void;
  header?: boolean;
  controls: string;
}) {
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      {...stylex.props(styles.processButton, header && styles.processHeader)}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <span>{label}</span>
      <m.span
        {...stylex.props(styles.chevron, hovered && styles.visibleChevron)}
        animate={{ rotate: open ? 90 : 0 }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 450, damping: 35 }}
      >
        <Icon name="chevron" size={14} />
      </m.span>
    </button>
  );
}

function ToolStep({ activity }: { activity: MessageActivity }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <Disclosure label={activity.title} open={open} onClick={() => setOpen(!open)} controls={id} />
      <div id={id} hidden={!open}>
        <div {...stylex.props(styles.toolSheet)} data-tool-detail-sheet="">
          {activity.command && (
            <div {...stylex.props(styles.toolSection)}>
              <pre {...stylex.props(styles.toolText)}>
                <code>{activity.command}</code>
              </pre>
            </div>
          )}
          {activity.output && (
            <div {...stylex.props(styles.toolSection)}>
              <pre {...stylex.props(styles.toolText)}>{activity.output}</pre>
            </div>
          )}
          {activity.status === 'failed' && (
            <div {...stylex.props(styles.toolSection, styles.error)}>执行失败</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProcessRegion({
  activities,
  finished,
  hasAnswer,
  duration,
}: {
  activities: readonly MessageActivity[];
  finished: boolean;
  hasAnswer: boolean;
  duration: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const folded = finished && hasAnswer;
  return (
    <div data-message-process="">
      {folded && (
        <Disclosure
          label={duration ? `已工作 ${duration}` : '已完成工作'}
          open={expanded}
          onClick={() => setExpanded(!expanded)}
          header
          controls={id}
        />
      )}
      <div id={id} hidden={folded && !expanded}>
        {activities.map((activity) => (
          <ToolStep key={activity.id} activity={activity} />
        ))}
      </div>
    </div>
  );
}

export function MessageSurface({
  role,
  text,
  status,
  timestamp = '',
  duration = '',
  attachments,
  configuration,
  activities = [],
}: {
  role: 'user' | 'agent';
  text: string;
  status: 'complete' | 'streaming' | 'stopped' | 'failed';
  timestamp?: string;
  duration?: string;
  attachments?: ReactNode;
  configuration?: ReactNode;
  activities?: readonly MessageActivity[] | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const { copied, error, copy } = useCopyFeedback();
  const user = role === 'user';
  const lineSlice = text.split('\n').slice(0, 10).join('\n').slice(0, 900);
  const long = lineSlice.length < text.length;
  const showFull = !long || expanded;
  const copyButton = text.trim() ? (
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
            onClick={() => void copy(text)}
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
        {!user && configuration}
      </div>
      {!user && status !== 'streaming' && timestamp && <span>{timestamp}</span>}
      {!user && status !== 'streaming' && !activities.length && duration && <span>{duration}</span>}
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
          {!!activities.length && (
            <ProcessRegion
              activities={activities}
              finished={status === 'complete'}
              hasAnswer={!!text.trim()}
              duration={duration}
            />
          )}
          {text && <MessageMarkdown value={text} />}
          {attachments}
          {status === 'streaming' && (
            <div {...stylex.props(styles.status)} data-message-live="">
              正在工作…
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
