import * as stylex from '@stylexjs/stylex';
import { SequenceStepProvider, useSequenceStep } from '@wibus/cuelens/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { Button } from '../../shared/ui/button';
import { introduction } from './sequence';

const styles = stylex.create({
  page: {
    display: 'grid',
    gridTemplateRows: '1fr auto',
    gap: 20,
    minHeight: 0,
    height: '100%',
    padding: 16,
  },
  demo: { display: 'grid', alignContent: 'center', gap: 16, minHeight: 0 },
  browser: {
    overflow: 'hidden',
    border: '1px solid #dedfd8',
    borderRadius: 18,
    backgroundColor: '#fff',
    boxShadow: '0 18px 48px #1e2b2418',
  },
  chrome: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    backgroundColor: '#f4f4f0',
    color: '#667068',
    fontSize: 11,
  },
  dot: { width: 7, height: 7, borderRadius: 99, backgroundColor: '#d0d5ce' },
  url: { flex: 1, borderRadius: 7, padding: '5px 9px', backgroundColor: '#fff' },
  article: { padding: 18, color: '#26352d' },
  eyebrow: {
    margin: '0 0 8px',
    color: '#557461',
    fontSize: 11,
    fontWeight: 650,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  headline: { margin: '0 0 10px', fontSize: 20, lineHeight: 1.2, letterSpacing: '-0.04em' },
  copy: { margin: 0, color: '#69756d', fontSize: 12, lineHeight: 1.65 },
  highlight: { borderRadius: 5, paddingInline: 3, backgroundColor: '#e1f1df' },
  panel: {
    display: 'grid',
    gap: 10,
    padding: 14,
    border: '1px solid #e4e8e2',
    borderRadius: 14,
    backgroundColor: '#fbfcfa',
  },
  panelTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#52675a',
    fontSize: 11,
    fontWeight: 650,
  },
  avatar: {
    display: 'grid',
    placeItems: 'center',
    width: 23,
    height: 23,
    borderRadius: 8,
    backgroundColor: '#e5eee5',
    color: '#42644c',
    fontSize: 11,
  },
  question: { margin: 0, color: '#29392f', fontSize: 12, lineHeight: 1.55 },
  response: { margin: 0, color: '#657168', fontSize: 11, lineHeight: 1.6 },
  caption: { display: 'grid', gap: 7 },
  label: { margin: 0, color: '#52675a', fontSize: 11, fontWeight: 650 },
  title: { margin: 0, color: '#1f2e25', fontSize: 22, letterSpacing: '-0.04em' },
  body: { margin: 0, color: '#68756c', fontSize: 13, lineHeight: 1.6 },
  footer: { display: 'flex', alignItems: 'center', gap: 8 },
  progress: { flex: 1, display: 'flex', gap: 4 },
  segment: { height: 3, flex: 1, borderRadius: 9, backgroundColor: '#e4e8e2' },
  active: { backgroundColor: '#51795d' },
  prompt: {
    padding: '8px 10px',
    border: '1px solid #e2e7e1',
    borderRadius: 9,
    color: '#657168',
    fontSize: 11,
  },
});

export function Introduction() {
  return (
    <SequenceStepProvider definition={introduction} initialStep="welcome">
      <IntroductionStep />
    </SequenceStepProvider>
  );
}

function IntroductionStep() {
  const step = useSequenceStep();
  const navigate = useNavigate();
  const [attached, setAttached] = useState(false);
  const index = step.index;
  const content = introduction.steps[index]?.state;
  if (!content) throw new Error('Introduction step is out of range');
  return (
    <section aria-label="首次使用引导" {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.demo)}>
        <div {...stylex.props(styles.browser)}>
          <div {...stylex.props(styles.chrome)}>
            <i {...stylex.props(styles.dot)} />
            <i {...stylex.props(styles.dot)} />
            <i {...stylex.props(styles.dot)} />
            <span {...stylex.props(styles.url)}>example.com / design-notes</span>
          </div>
          <article {...stylex.props(styles.article)}>
            <p {...stylex.props(styles.eyebrow)}>网页里的灵感</p>
            <h2 {...stylex.props(styles.headline)}>把看到的内容，变成下一步行动。</h2>
            <p {...stylex.props(styles.copy)}>
              这篇文章介绍了如何用更少的会议，让团队保持同步。
              <span {...stylex.props(styles.highlight)}>清晰的异步沟通</span>，从理解上下文开始。
            </p>
          </article>
        </div>
        <div {...stylex.props(styles.panel)}>
          <div {...stylex.props(styles.panelTop)}>
            <span {...stylex.props(styles.avatar)}>L</span> Lody{' '}
            <span style={{ marginInlineStart: 'auto' }}>网页助手</span>
          </div>
          {index === 0 ? (
            <>
              <p {...stylex.props(styles.question)}>
                帮我用三句话总结这篇文章，并给一个可以马上尝试的建议。
              </p>
              <p {...stylex.props(styles.response)}>
                核心观点：减少同步会议、把决策写下来、让每个人都能按自己的节奏推进。今天可以先把一个状态更新改成文字说明。
              </p>
              <div {...stylex.props(styles.prompt)}>问问这篇网页……{'\u3000'}↗</div>
            </>
          ) : (
            <>
              <p {...stylex.props(styles.question)}>
                {attached
                  ? '已附上当前网页。帮我提炼文章的三个重点。'
                  : '在页面上选中一段文字，或点击下方按钮，把上下文带进对话。'}
              </p>
              <Button
                size="small"
                variant={attached ? 'secondary' : 'primary'}
                onClick={() => setAttached((value) => !value)}
              >
                {attached ? '✓ 已附上网页 · 移除' : '+ 附上当前网页'}
              </Button>
              {attached && (
                <p {...stylex.props(styles.response)}>
                  已准备好网页标题和内容摘要；你可以在发送前检查上下文。
                </p>
              )}
            </>
          )}
        </div>
        <div {...stylex.props(styles.caption)}>
          <p {...stylex.props(styles.label)}>
            快速上手{'\u3000'}·{'\u3000'}0{index + 1} / 02
          </p>
          <h1 {...stylex.props(styles.title)}>{content.title}</h1>
          <p {...stylex.props(styles.body)}>{content.body}</p>
        </div>
      </div>
      <footer {...stylex.props(styles.footer)}>
        <Button variant="ghost" size="small" onClick={() => navigate('/')}>
          跳过
        </Button>
        <div aria-label={`第 ${index + 1} 步，共 2 步`} {...stylex.props(styles.progress)}>
          {introduction.steps.map((_, i) => (
            <span key={i} {...stylex.props(styles.segment, i <= index && styles.active)} />
          ))}
        </div>
        {index > 0 && (
          <Button variant="secondary" size="small" onClick={() => step.previous()}>
            上一步
          </Button>
        )}
        {index < introduction.steps.length - 1 ? (
          <Button size="small" onClick={() => step.next()}>
            下一步
          </Button>
        ) : (
          <Button size="small" onClick={() => navigate('/')}>
            开始使用
          </Button>
        )}
      </footer>
    </section>
  );
}
