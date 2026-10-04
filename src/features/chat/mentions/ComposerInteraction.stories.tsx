import type { Meta, StoryObj } from '@storybook/react-vite';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { userEvent, within } from 'storybook/test';

import { Icon } from '../../../shared/icons/Icon';
import { Button } from '../../../shared/ui';
import type { PageContext } from '../../connection/client';
import { Composer } from '../Composer';
import { editMentionRanges, expandComposerMentions } from './core';
import type { ComposerMentionItem, ComposerMentionRange, ComposerMentionSource } from './types';

const scopeKey = 'storybook-composer-preview';
const token = '$page-research';
const template = `请用 ${token} 核对 {{主题}} 的来源。`;
const skillExpansion = 'use /page-research [Skill Path](/preview/skills/page-research/SKILL.md)';

/** Story-only source: no account, browser capture, persistence or network calls. */
function previewSource(failOnce: boolean): ComposerMentionSource {
  let failureRemaining = failOnce;
  const shortcuts: ComposerMentionItem[] = [
    {
      id: 'review',
      kind: 'shortcut',
      label: 'review-sources',
      iconEmoji: '🔎',
      description: '保留引用与待核对的问题 · 私有',
      detail: {
        title: '核对页面来源',
        meta: ['私有', '当前工作区'],
        description: template,
        rows: [{ label: '适用范围', value: '当前机器 · Codex' }],
      },
      prepare: async () => ({
        text: template,
        ranges: [
          {
            start: template.indexOf(token),
            end: template.indexOf(token) + token.length,
            text: token,
            expansion: skillExpansion,
          },
        ],
      }),
    },
    {
      id: 'team',
      kind: 'shortcut',
      label: 'team-summary',
      iconEmoji: '📝',
      description: '团队摘要 · 工作区共享',
      detail: {
        title: '团队摘要',
        meta: ['同事分享', '只读'],
        description: '概括核心结论，引用资料并保留不确定的部分。',
      },
      prepare: async () => ({ text: '概括核心结论，引用资料并保留不确定的部分。' }),
    },
    {
      id: 'unavailable',
      kind: 'shortcut',
      label: 'project-review',
      iconEmoji: '🧭',
      description: '项目审阅 · 私有',
      exactMatchTerms: ['project-review', '项目审阅'],
      disabledReason: '需要切换到快捷指令所属项目。',
      detail: {
        title: '项目审阅',
        description: '此预览展示原版不可用条目；精确搜索会保留原因。',
        rows: [{ label: '需要项目', value: 'Lody / browser-assistant' }],
      },
      prepare: async () => {
        throw new Error('该预览条目当前不可用。');
      },
    },
    ...Array.from({ length: 24 }, (_, index): ComposerMentionItem => ({
      id: `reading-${index}`,
      kind: 'shortcut',
      label: `reading-${String(index + 1).padStart(2, '0')}`,
      iconEmoji: index % 2 ? '📚' : '💡',
      description: `阅读笔记 ${index + 1} · 示例共享资料与较长说明`,
      detail: {
        title: `阅读笔记 ${index + 1}`,
        description: '这段示例用于检查长列表、手势滚动、键盘高亮和详情布局。',
      },
      prepare: async () => ({ text: `请整理第 ${index + 1} 份资料，保留来源。` }),
    })),
  ];
  return {
    scopeKey,
    categories: ['tab', 'skill', 'session', 'shortcut', 'command'],
    load: async (kind, signal) => {
      signal.throwIfAborted();
      if (failureRemaining && kind === 'shortcut') {
        failureRemaining = false;
        throw new Error('预览：快捷指令目录暂时无法读取。可点重新读取，草稿不变。');
      }
      switch (kind) {
        case 'shortcut':
          return shortcuts;
        case 'command':
          return [
            {
              id: 'compact',
              kind,
              label: '/compact',
              description: '压缩当前上下文',
              prepare: async () => ({ text: '/compact' }),
            },
            {
              id: 'review',
              kind,
              label: '/review',
              description: '检查当前修改',
              prepare: async () => ({ text: '/review' }),
            },
          ];
        case 'skill':
          return [
            {
              id: 'research',
              kind,
              label: token,
              description: '检查资料来源与证据 · 全局技能',
              detail: {
                title: '页面研究',
                rows: [{ label: '位置', value: '/preview/skills/page-research/SKILL.md' }],
              },
              prepare: async () => ({ text: token, expansion: skillExpansion }),
            },
            {
              id: 'writing',
              kind,
              label: '$clear-writing',
              description: '改进文档与说明 · 项目技能',
              prepare: async () => ({
                text: '$clear-writing',
                expansion: 'use /clear-writing [Skill Path](.agents/skills/clear-writing/SKILL.md)',
              }),
            },
          ];
        case 'session':
          return [
            {
              id: 'session-example',
              kind,
              label: '浏览器助手的设计讨论',
              description: '预览会话 · 提及不会切换当前会话',
              detail: { title: '浏览器助手的设计讨论', meta: ['示例工作区', 'Codex'] },
              prepare: async () => ({
                text: '@浏览器助手的设计讨论',
                expansion: '[@浏览器助手的设计讨论](session://preview-session)',
              }),
            },
          ];
        case 'tab':
          return [
            {
              id: 'page-example',
              kind,
              label: 'Lody 文档（示例页面）',
              description: 'https://example.test/docs · 仅内存快照',
              prepare: async () => ({
                text: '',
                context: {
                  id: 'preview-page',
                  kind: 'page',
                  title: 'Lody 文档（示例页面）',
                  url: 'https://example.test/docs',
                  text: '这是一份固定的 Storybook 页面资料，不读取任何真实标签。',
                  trust: 'untrusted',
                },
              }),
            },
          ];
      }
    },
  };
}

const styles = stylex.create({
  page: {
    marginInline: 'auto',
    minHeight: '100dvh',
    padding: 12,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  width: (width: number) => ({ width, maxWidth: '100%' }),
  guide: { margin: 0, fontSize: 13, lineHeight: 1.6, overflowWrap: 'anywhere' },
  space: { flex: 1, minHeight: 280 },
  result: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontSize: 13,
    maxHeight: 180,
    overflowY: 'auto',
  },
  attachments: { display: 'flex', gap: 4, flexWrap: 'wrap', paddingBlock: 4 },
});
interface Props {
  width: number;
  trigger: string;
  failOnce?: boolean;
}
function Preview({ width, failOnce = false }: Props) {
  const [source] = useState(() => previewSource(failOnce));
  const [draft, setDraft] = useState<{
    text: string;
    ranges: readonly ComposerMentionRange[];
    contexts: PageContext[];
  }>({ text: '', ranges: [], contexts: [] });
  const [result, setResult] = useState('');
  const preview = () => setResult(expandComposerMentions(draft.text, draft.ranges, scopeKey));
  return (
    <main {...stylex.props(styles.page, styles.width(width))}>
      <p {...stylex.props(styles.guide)}>
        纯预览数据，不连接账号或云端，也不读取真实网页。输入
        /、@、$；用上下选择、左右进入/返回，或触摸滚动和点选。精确输入 /project-review
        查看不可用原因。
      </p>
      <div {...stylex.props(styles.space)} />
      <Composer
        value={draft.text}
        disabled={false}
        mentionSource={source}
        mentionRanges={draft.ranges}
        onChange={(text) =>
          setDraft((current) => ({
            ...current,
            text,
            ranges: editMentionRanges(current.text, text, current.ranges),
          }))
        }
        onMentionCommit={(text, ranges = [], context) =>
          setDraft((current) => ({
            text,
            ranges: [...editMentionRanges(current.text, text, current.ranges), ...ranges],
            contexts: context
              ? [...current.contexts.filter((row) => row.id !== context.id), context]
              : current.contexts,
          }))
        }
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            preview();
          }
        }}
        attachments={
          draft.contexts.length ? (
            <div {...stylex.props(styles.attachments)}>
              {draft.contexts.map((context) => (
                <Button
                  key={context.id}
                  variant="ghost"
                  size="small"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      contexts: current.contexts.filter((row) => row.id !== context.id),
                    }))
                  }
                >
                  移除 {context.title}
                </Button>
              ))}
            </div>
          ) : null
        }
        attachmentAction={null}
        configuration={<span {...stylex.props(styles.guide)}>Codex · 预览</span>}
        primaryAction={
          <Button size="small" icon aria-label="查看展开后的提示词" onClick={preview}>
            <Icon name="send" size={16} />
          </Button>
        }
      />
      <output aria-label="展开后的提示词预览" {...stylex.props(styles.result)}>
        {result || '选择只修改草稿；发送按钮在此仅预览展开后的文字。'}
      </output>
    </main>
  );
}

const meta = {
  title: 'Chat/Composer interaction',
  component: Preview,
  parameters: { layout: 'fullscreen' },
  args: { width: 360, trigger: '/' },
  play: async ({ canvasElement, args }) => {
    const input = within(canvasElement).getByRole('textbox', { name: '消息' });
    await userEvent.click(input);
    await userEvent.type(input, args.trigger);
  },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NarrowCommands: Story = {};
export const NarrowCategories: Story = { args: { trigger: '@' } };
export const NarrowSkills: Story = { args: { trigger: '$' } };
export const LongShortcutList: Story = { args: { trigger: '@shortcut:' } };
export const WideDetails: Story = { args: { width: 920, trigger: '/review-sources' } };
export const DisabledExact: Story = { args: { trigger: '/project-review' } };
export const ReadFailure: Story = { args: { trigger: '/', failOnce: true } };
