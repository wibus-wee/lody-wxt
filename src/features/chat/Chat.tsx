import * as stylex from '@stylexjs/stylex';
import type { ComponentProps, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import * as v from 'valibot';

import { text } from '../../../vendor/lody/packages/ui/src/tokens/scales.stylex';
import { Icon } from '../../shared/icons/Icon';
import { Button, Menu } from '../../shared/ui';
import { composer as composerTokens } from '../../shared/ui/composer.stylex';
import { messageSurface } from '../../shared/ui/message.stylex';
import { Composer } from './Composer';
import type { ChatMessage } from './MessageView';
import { MessageView } from './MessageView';

const styles = stylex.create({
  chat: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 },
  title: {
    margin: '0 16px 6px',
    fontSize: 12,
    color: composerTokens.hint,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  suggestions: { display: 'grid', gap: 6, width: '100%', maxWidth: 260, marginTop: 24 },
  suggestion: { justifyContent: 'start', gap: 10, minHeight: 40 },
  description: { fontSize: 13, color: composerTokens.hint, margin: '8px 0 0' },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    minWidth: 0,
    scrollbarGutter: 'stable',
    overscrollBehavior: 'contain',
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    flexDirection: 'column',
    justifyContent: 'center',
    minHeight: '100%',
    padding: '24px 20px',
    textAlign: 'center',
  },
  greeting: { margin: 0, fontSize: 24, lineHeight: 1.25, fontWeight: 600, letterSpacing: '-0.8px' },
  composer: { display: 'grid', gap: 8, padding: '0 12px 8px', flexShrink: 0 },
  feedback: {
    display: 'grid',
    gap: 8,
    paddingInline: 12,
    maxHeight: '35dvh',
    overflowY: 'auto',
    flexShrink: 0,
    marginBottom: { default: 8, ':empty': 0 },
  },
  jump: { alignSelf: 'center' },
  hint: {
    fontSize: text.captionSize,
    lineHeight: text.captionLeading,
    margin: 0,
    textAlign: 'center',
    color: composerTokens.hint,
  },
});

const scrollSchema = v.object({ top: v.number(), following: v.boolean() });
function readScroll(key?: string) {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(`lody:scroll:${key}`);
    return raw ? v.parse(scrollSchema, JSON.parse(raw)) : null;
  } catch {
    return null; /* Presentation state is optional; invalid scroll data never changes messages. */
  }
}
export interface ChatProps {
  messages: readonly ChatMessage[];
  composer: ComponentProps<typeof Composer>;
  onSubmit: () => void;
  conversationControl: ReactNode;
  title?: string | undefined;
  scrollKey?: string;
  onSuggestion?: (kind: 'summary' | 'selection' | 'question' | 'translate' | 'reply') => void;
  suggestionsDisabled?: boolean;
  feedback?: ReactNode;
  status?: ReactNode;
  footer?: ReactNode;
}

export function Chat({
  messages,
  composer,
  onSubmit,
  conversationControl,
  feedback,
  status,
  footer,
  title,
  onSuggestion,
  suggestionsDisabled,
  scrollKey,
}: ChatProps) {
  const [restored] = useState(() => readScroll(scrollKey));
  const [following, setFollowing] = useState(restored?.following ?? true);
  const scrollRef = useRef<HTMLElement>(null);
  const last = messages.at(-1);
  useEffect(() => {
    if (restored && !restored.following && scrollRef.current)
      scrollRef.current.scrollTop = restored.top;
  }, [restored]);
  useEffect(() => {
    if (!scrollKey) return;
    const node = scrollRef.current;
    const save = () => {
      try {
        if (node)
          sessionStorage.setItem(
            `lody:scroll:${scrollKey}`,
            JSON.stringify({ top: node.scrollTop, following }),
          );
      } catch {
        /* Scroll persistence is optional. */
      }
    };
    window.addEventListener('pagehide', save);
    return () => {
      save();
      window.removeEventListener('pagehide', save);
    };
  }, [scrollKey, following]);
  useEffect(() => {
    if (following && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [following, last?.text, last?.content, messages.length]);
  return (
    <section {...stylex.props(styles.chat)} aria-label="Lody 会话">
      {conversationControl}
      {title && <p {...stylex.props(styles.title)}>{title}</p>}
      <section
        ref={scrollRef}
        {...stylex.props(styles.scroll)}
        aria-label="消息记录"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll the transcript.
        tabIndex={0}
        onClickCapture={(event) => {
          if (event.target instanceof Element && event.target.closest('button[aria-expanded]'))
            setFollowing(false);
        }}
        onPointerUp={() => {
          if (window.getSelection()?.toString()) setFollowing(false);
        }}
        onScroll={() => {
          const node = scrollRef.current;
          if (node) setFollowing(node.scrollHeight - node.clientHeight - node.scrollTop < 60);
        }}
      >
        {!messages.length && (
          <div {...stylex.props(styles.empty)}>
            <Icon name="chat" size={28} />
            <h2 {...stylex.props(styles.greeting)}>有什么想聊的？</h2>
            <p {...stylex.props(styles.description)}>关于眼前的网页，或任何突发奇想。</p>
            {onSuggestion && (
              <div {...stylex.props(styles.suggestions)}>
                <Button
                  variant="ghost"
                  disabled={suggestionsDisabled}
                  {...stylex.props(styles.suggestion)}
                  onClick={() => onSuggestion('summary')}
                >
                  <Icon name="page" size={18} />
                  总结这个网页
                </Button>
                <Button
                  variant="ghost"
                  disabled={suggestionsDisabled}
                  {...stylex.props(styles.suggestion)}
                  onClick={() => onSuggestion('selection')}
                >
                  <Icon name="page" size={18} />
                  解释选中的文字
                </Button>
                <Button
                  variant="ghost"
                  disabled={suggestionsDisabled}
                  {...stylex.props(styles.suggestion)}
                  onClick={() => onSuggestion('question')}
                >
                  <Icon name="chat" size={18} />
                  帮我梳理思路
                </Button>
                <Menu.Root>
                  <Menu.Trigger
                    render={<Button variant="ghost" size="small" disabled={suggestionsDisabled} />}
                  >
                    翻译与写作
                  </Menu.Trigger>
                  <Menu.Content>
                    <Menu.Item onClick={() => onSuggestion('translate')}>翻译选中的文字</Menu.Item>
                    <Menu.Item onClick={() => onSuggestion('reply')}>根据网页起草回复</Menu.Item>
                  </Menu.Content>
                </Menu.Root>
              </div>
            )}
          </div>
        )}
        <div {...stylex.props(messageSurface.column)}>
          {messages.map((message) => (
            <MessageView key={message.id} message={message} />
          ))}
        </div>
      </section>
      {!following && (
        <Button
          {...stylex.props(styles.jump)}
          variant="secondary"
          size="small"
          onClick={() => setFollowing(true)}
        >
          回到最新
        </Button>
      )}
      <div {...stylex.props(styles.feedback)}>{feedback}</div>
      <form
        {...stylex.props(styles.composer)}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {status}
        <Composer {...composer} />
        {footer && <div {...stylex.props(styles.hint)}>{footer}</div>}
      </form>
    </section>
  );
}
