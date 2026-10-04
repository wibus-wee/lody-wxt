import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { createContext, isValidElement, useContext, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { text } from '../../../vendor/lody/packages/ui/src/tokens/scales.stylex';
import { Icon } from '../icons/Icon';
import { Button } from './button';
import { composer } from './composer.stylex';
import { messageSurface } from './message.stylex';
import { syntax } from './message.tokens.stylex';
import { useCodeTokens } from './use-code-tokens';
import { useCopyFeedback } from './use-copy-feedback';

// Lody ai-gui/markdown-renderer.tsx and tailwind/index.css own this prose/fence rhythm.
const styles = stylex.create({
  markdown: {
    minWidth: 0,
    overflowWrap: 'anywhere',
    fontSize: text.bodySize,
    lineHeight: text.bodyLeading,
    color: composer.label,
    '--lody-shiki-foreground': composer.label,
    '--lody-shiki-token-comment': syntax.comment,
    '--lody-shiki-token-string': syntax.string,
    '--lody-shiki-token-constant': syntax.number,
    '--lody-shiki-token-keyword': syntax.keyword,
    '--lody-shiki-token-parameter': syntax.variable,
    '--lody-shiki-token-function': syntax.function,
    '--lody-shiki-token-string-expression': syntax.string,
    '--lody-shiki-token-punctuation': composer.label,
    '--lody-shiki-token-link': syntax.title,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: { default: 12, ':last-child': 0, ':has(+ul)': 8 },
    ':is(li > p)': { display: 'inline', margin: 0 },
  },
  list: {
    marginBlock: { default: 8, ':is(li > ul,li > ol)': 4 },
    paddingLeft: 0,
    listStyleType: 'none',
  },
  item: {
    position: 'relative',
    paddingLeft: 24,
    paddingBlock: 0,
    marginBlock: { default: 0, ':not(:first-child)': '4px 0' },
  },
  bullet: {
    '::before': {
      position: 'absolute',
      left: 10,
      top: '0.75em',
      width: 4,
      height: 4,
      transform: 'translateY(-50%)',
      borderRadius: '50%',
      backgroundColor: 'currentColor',
      content: '""',
    },
  },
  number: {
    '::before': {
      position: 'absolute',
      left: 0,
      width: 18,
      whiteSpace: 'nowrap',
      textAlign: 'right',
      content: 'counter(list-item) "."',
    },
  },
  heading: {
    color: composer.label,
    fontWeight: 600,
    marginBottom: 8,
    ':first-child': { marginTop: 0 },
  },
  h1: {
    fontSize: text.titleSize,
    lineHeight: text.titleLeading,
    marginTop: 24,
    letterSpacing: '-0.02em',
  },
  h2: {
    fontSize: text.headlineSize,
    lineHeight: text.titleLeading,
    marginTop: 20,
    letterSpacing: '-0.02em',
  },
  h3: { fontSize: text.bodySize, lineHeight: text.bodyLeading, marginTop: 16 },
  smallHeading: {
    fontSize: text.footnoteSize,
    lineHeight: text.footnoteLeading,
    marginTop: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.025em',
  },
  bold: { fontWeight: 600, color: composer.label },
  link: {
    color: syntax.title,
    textDecoration: { default: 'none', ':hover': 'underline' },
    textUnderlineOffset: 2,
  },
  quote: {
    margin: '12px 0',
    paddingLeft: 12,
    borderLeft: `2px solid ${composer.border}`,
    color: composer.hint,
  },
  rule: { marginBlock: 16, borderWidth: 0, borderTop: `1px solid ${composer.border}` },
  inlineCode: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: text.subheadlineSize,
    padding: '1px 4px',
    borderRadius: 4,
    backgroundColor: `color-mix(in srgb, ${composer.label} 8%, transparent)`,
  },
  tableScroll: { overflowX: 'auto', maxWidth: '100%', marginBlock: 12 },
  table: {
    borderCollapse: 'collapse',
    fontSize: text.bodySize,
    lineHeight: text.bodyLeading,
    width: 'max-content',
    minWidth: '100%',
  },
  cell: {
    borderBottom: `1px solid color-mix(in srgb, ${composer.label} 8%, transparent)`,
    padding: '6px 10px',
    verticalAlign: 'top',
    ':not(:first-child)': {
      borderLeft: `1px solid color-mix(in srgb, ${composer.label} 8%, transparent)`,
    },
  },
  head: {
    fontWeight: 400,
    textAlign: 'left',
    backgroundColor: `color-mix(in srgb, ${composer.label} 3.5%, transparent)`,
    borderBottom: `1px solid color-mix(in srgb, ${composer.label} 14%, transparent)`,
  },
  fence: {
    width: '100%',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    marginBlock: 14,
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: syntax.fence,
    color: composer.label,
  },
  toolbar: {
    display: 'flex',
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingInline: 10,
    borderBottom: `0.5px solid ${composer.border}`,
    color: syntax.comment,
  },
  language: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: text.captionSize,
    lineHeight: text.captionLeading,
    letterSpacing: '0.02em',
  },
  tools: { display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 },
  tool: { flexShrink: 0 },
  codeScroll: { overflowX: 'auto', padding: '12px 16px', minWidth: 0 },
  code: {
    margin: 0,
    minWidth: 'max-content',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: text.subheadlineSize,
    lineHeight: text.subheadlineLeading,
    whiteSpace: 'pre',
  },
  wrap: { minWidth: 0, width: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  preview: { padding: '8px 6px 12px' },
});
const markdownLanguages = new Set(['md', 'markdown', 'mdx', 'gfm', 'mdown', 'mkd']);
const trailingNewlines = /\n+$/u;
const safeLink = /^https?:\/\//u;
const aliases: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  sh: 'shellscript',
  shell: 'shellscript',
  yml: 'yaml',
};
const OrderedListContext = createContext(false);
function ListItem({ children }: { children: ReactNode }) {
  const ordered = useContext(OrderedListContext);
  return (
    <li {...stylex.props(styles.item, ordered ? styles.number : styles.bullet)}>{children}</li>
  );
}

function MessageCodeBlock({ code, language }: { code: string; language: string }) {
  const [wrapped, setWrapped] = useState(false);
  const [preview, setPreview] = useState(false);
  const { copied, error, copy } = useCopyFeedback(2000);
  const trimmed = code.replace(trailingNewlines, '');
  const lines = useCodeTokens(trimmed, aliases[language] ?? language);
  return (
    <div
      {...stylex.props(styles.fence)}
      data-streamdown="code-block"
      data-code-wrap={wrapped || undefined}
      data-language={language}
    >
      <div {...stylex.props(styles.toolbar)} data-streamdown="code-block-toolbar">
        <span {...stylex.props(styles.language)}>{language}</span>
        <div {...stylex.props(styles.tools)}>
          {markdownLanguages.has(language) && (
            <Button
              variant="ghost"
              size="mini"
              icon
              type="button"
              aria-label={preview ? '隐藏预览' : '预览 Markdown'}
              aria-pressed={preview}
              title="预览 Markdown"
              {...stylex.props(styles.tool)}
              onClick={() => setPreview(!preview)}
            >
              <Icon name="readOnly" size={14} />
            </Button>
          )}
          {!preview && (
            <Button
              variant="ghost"
              size="mini"
              icon
              type="button"
              aria-label="代码自动换行"
              aria-pressed={wrapped}
              title="代码自动换行"
              {...stylex.props(styles.tool)}
              onClick={() => setWrapped(!wrapped)}
            >
              <Icon name="wrap" size={14} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="mini"
            icon
            type="button"
            aria-label="复制代码"
            data-copied={copied || undefined}
            title={copied ? '已复制' : '复制代码'}
            {...stylex.props(styles.tool)}
            onClick={() => void copy(trimmed)}
          >
            <Icon name={copied ? 'check' : 'copy'} size={14} />
          </Button>
        </div>
      </div>
      {preview ? (
        <div {...stylex.props(styles.preview)}>
          <MessageMarkdown value={code} />
        </div>
      ) : (
        <section
          {...stylex.props(styles.codeScroll)}
          data-streamdown="code-block-body"
          aria-label={`代码内容 ${language}`}
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Horizontal code scrolling must be reachable by keyboard.
          tabIndex={0}
        >
          <pre {...stylex.props(styles.code, wrapped && styles.wrap)}>
            <code>
              {lines
                ? lines.map((line, index) => (
                    <span key={index}>
                      {index > 0 ? '\n' : ''}
                      {line.map((token, tokenIndex) => (
                        <span
                          key={tokenIndex}
                          style={{
                            color: token.htmlStyle?.color ?? token.color,
                            fontStyle: token.htmlStyle?.['font-style'],
                            fontWeight: token.htmlStyle?.['font-weight'],
                            textDecoration: token.htmlStyle?.['text-decoration'],
                          }}
                        >
                          {token.content}
                        </span>
                      ))}
                    </span>
                  ))
                : trimmed}
            </code>
          </pre>
        </section>
      )}
      {error && <output {...stylex.props(messageSurface.error)}>{error}</output>}
    </div>
  );
}

export function MessageMarkdown({ value }: { value: string }) {
  return (
    <div {...stylex.props(styles.markdown)} data-message-prose="">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p {...stylex.props(styles.paragraph)}>{children}</p>,
          h1: ({ children }) => <h1 {...stylex.props(styles.heading, styles.h1)}>{children}</h1>,
          h2: ({ children }) => <h2 {...stylex.props(styles.heading, styles.h2)}>{children}</h2>,
          h3: ({ children }) => <h3 {...stylex.props(styles.heading, styles.h3)}>{children}</h3>,
          h4: ({ children }) => <h4 {...stylex.props(styles.heading, styles.h3)}>{children}</h4>,
          h5: ({ children }) => (
            <h5 {...stylex.props(styles.heading, styles.smallHeading)}>{children}</h5>
          ),
          h6: ({ children }) => (
            <h6 {...stylex.props(styles.heading, styles.smallHeading)}>{children}</h6>
          ),
          strong: ({ children }) => <strong {...stylex.props(styles.bold)}>{children}</strong>,
          ul: ({ children }) => (
            <OrderedListContext.Provider value={false}>
              <ul {...stylex.props(styles.list)}>{children}</ul>
            </OrderedListContext.Provider>
          ),
          ol: ({ children, start }) => (
            <OrderedListContext.Provider value>
              <ol start={start} {...stylex.props(styles.list)}>
                {children}
              </ol>
            </OrderedListContext.Provider>
          ),
          li: ({ children }) => <ListItem>{children}</ListItem>,
          a: ({ href, children }) =>
            href && safeLink.test(href) ? (
              <a
                {...stylex.props(styles.link)}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => <span>{alt}</span>,
          blockquote: ({ children }) => (
            <blockquote {...stylex.props(styles.quote)}>{children}</blockquote>
          ),
          hr: () => <hr {...stylex.props(styles.rule)} />,
          code: ({ children }) => <code {...stylex.props(styles.inlineCode)}>{children}</code>,
          pre: ({ children }) => {
            const child = Array.isArray(children) ? children[0] : children;
            if (!isValidElement<{ children?: string; className?: string }>(child)) return null;
            const language = child.props.className?.replace('language-', '') ?? '';
            return (
              <MessageCodeBlock code={String(child.props.children ?? '')} language={language} />
            );
          },
          table: ({ children }) => (
            <section
              {...stylex.props(styles.tableScroll)}
              aria-label="表格内容"
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Wide tables own a keyboard-accessible horizontal scroller.
              tabIndex={0}
            >
              <table {...stylex.props(styles.table)}>{children}</table>
            </section>
          ),
          th: ({ children, style }) => (
            <th style={style} {...stylex.props(styles.cell, styles.head)}>
              {children}
            </th>
          ),
          td: ({ children, style }) => (
            <td style={style} {...stylex.props(styles.cell)}>
              {children}
            </td>
          ),
        }}
      >
        {value}
      </Markdown>
    </div>
  );
}
