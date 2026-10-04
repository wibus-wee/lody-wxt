import * as stylex from '@stylexjs/stylex';
import { useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useId, useState } from 'react';
import * as v from 'valibot';

import { conversationSurface as official } from '../../../../vendor/lody/packages/components/src/components/ai-gui/surface';
import { feedback } from '../../../../vendor/lody/packages/ui/src/feedback/feedback.tokens.stylex';
import { text } from '../../../../vendor/lody/packages/ui/src/tokens/scales.stylex';
import { Icon } from '../../icons/Icon';
import { Button } from '../button';
import { composer } from '../composer.stylex';
import { Spinner } from '../index';
import { messageSurface } from '../message.stylex';
import { MessageMarkdown } from '../MessageMarkdown';
import type {
  AssistantActivitySummary,
  AssistantTurnRenderBlock,
} from './assistant-turn-render-blocks';
import { buildAssistantTurnRenderLayout } from './assistant-turn-render-blocks';
import type { MessageContent } from './content';
import { readConversationContent } from './content';
import { specializedContentSchema } from './specialized-content';
import { SpecializedContent } from './SpecializedContent';
import { toolContent } from './tool-content';

const smallSpinner = stylex.createTheme(feedback, { spinnerSmall: '12px' });
const styles = stylex.create({
  spinner: {
    flexShrink: 0,
    animationName: { default: null, '@media (prefers-reduced-motion: reduce)': 'none' },
  },
  region: { minWidth: 0, maxWidth: '100%' },
  disclosure: {
    justifyContent: 'start',
    minWidth: 0,
    maxWidth: '100%',
    height: 'auto',
    fontSize: text.subheadlineSize,
    lineHeight: text.subheadlineLeading,
    fontWeight: 400,
    color: composer.label,
  },
  title: {
    color: composer.label,
    fontSize: text.subheadlineSize,
    lineHeight: text.subheadlineLeading,
    fontWeight: 400,
    display: 'block',
    minWidth: 0,
    flexShrink: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'start',
  },
  chevron: { display: 'inline-flex', flexShrink: 0 },
  prose: { paddingBlock: 4, paddingInline: 4, minWidth: 0 },
  detail: { minWidth: 0, paddingBlock: '4px 6px' },
  thought: { minWidth: 0, paddingBlock: 2, paddingInline: 4 },
});

// Port of view.tsx ProcessDisclosureButton, using Lody controls and the extension's mood icons.
function Disclosure({
  label,
  expanded,
  onToggle,
  controls,
  busy = false,
  fullTitle,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  controls: string;
  busy?: boolean;
  fullTitle?: string | undefined;
}) {
  const reduced = useReducedMotion();
  return (
    <Button
      type="button"
      variant="ghost"
      size="small"
      {...stylex.props(official.disclosure, styles.disclosure)}
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
    >
      <span {...stylex.props(styles.title)} title={fullTitle ?? label}>
        {label}
      </span>
      <m.span
        {...stylex.props(styles.chevron)}
        animate={{ rotate: expanded ? 90 : 0 }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 450, damping: 35 }}
      >
        <Icon name="chevron" size={12} />
      </m.span>
      {busy && (
        <Spinner size="small" label={null} {...stylex.props(smallSpinner, styles.spinner)} />
      )}
    </Button>
  );
}

function activityLabel(summary: AssistantActivitySummary) {
  return (
    [
      summary.commandCount ? `${summary.commandCount} 条命令` : '',
      summary.readFileCount ? `读取 ${summary.readFileCount} 个文件` : '',
      summary.editFileCount ? `修改 ${summary.editFileCount} 个文件` : '',
      summary.searchCount ? `${summary.searchCount} 次搜索` : '',
      summary.fetchCount ? `${summary.fetchCount} 次获取` : '',
      summary.otherCount ? `${summary.otherCount} 次工具调用` : '',
    ]
      .filter(Boolean)
      .join(' · ') || (summary.hasThought ? '思考过程' : '工作过程')
  );
}

function ToolStep({
  content,
  live,
}: {
  content: Extract<MessageContent, { type: 'tool_call' }>;
  live: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const detail = toolContent(content);
  const isRunning = live && new Set(['pending', 'in_progress']).has(content.status ?? '');
  const path = content.locations?.[0]?.path;
  const fileName = path?.replaceAll('\\', '/').split('/').at(-1);
  const fileLabel = content.kind === 'read' ? '读取' : content.kind === 'edit' ? '修改' : '';
  const title =
    fileLabel && fileName ? `${fileLabel} ${fileName}` : content.title?.trim() || '工具调用';
  const label = [content.status === 'failed' ? '执行失败' : '', title].filter(Boolean).join(' · ');
  return (
    <div {...stylex.props(styles.region)} data-tool-step="">
      <Disclosure
        label={label}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        controls={id}
        busy={isRunning}
        fullTitle={path || content.title || undefined}
      />
      <div id={id} hidden={!expanded} {...stylex.props(styles.detail)}>
        <div {...stylex.props(messageSurface.toolSheet)} data-tool-detail-sheet="">
          {detail.command && (
            <div {...stylex.props(messageSurface.toolSection)}>
              <pre {...stylex.props(messageSurface.toolText)}>
                <code>{detail.command}</code>
              </pre>
            </div>
          )}
          {detail.output && (
            <div {...stylex.props(messageSurface.toolSection)}>
              <pre {...stylex.props(messageSurface.toolText)}>{detail.output}</pre>
            </div>
          )}
          {!detail.command && !detail.output && (
            <div {...stylex.props(messageSurface.toolSection)}>
              <pre {...stylex.props(messageSurface.toolText)}>
                {JSON.stringify(content, null, 2)}
              </pre>
            </div>
          )}
          {content.status === 'failed' && (
            <div {...stylex.props(messageSurface.toolSection, messageSurface.error)}>执行失败</div>
          )}
        </div>
      </div>
    </div>
  );
}

function RetainedItem({ content, live = false }: { content: MessageContent; live?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (content.type === 'text')
    return (
      <div {...stylex.props(styles.prose)} data-answer-block="">
        <MessageMarkdown value={content.text} />
      </div>
    );
  if (content.type === 'proposed_plan')
    return (
      <div {...stylex.props(styles.prose)}>
        <MessageMarkdown value={content.markdown} />
      </div>
    );
  if (content.type === 'thought')
    return (
      <div {...stylex.props(styles.thought)}>
        <MessageMarkdown value={content.text} compact />
      </div>
    );
  if (content.type === 'tool_call') return <ToolStep content={content} live={live} />;
  if (v.safeParse(specializedContentSchema, content.raw).success)
    return (
      <SpecializedContent
        raw={content.raw}
        renderSubagent={(items) => (
          <AssistantTurn
            items={readConversationContent(items)}
            status={live ? 'streaming' : 'stopped'}
            duration=""
          />
        )}
      />
    );
  const label =
    content.type === 'unsupported' ? '暂不支持的消息内容' : `消息详情 · ${content.type}`;
  return (
    <div {...stylex.props(styles.region)}>
      <Disclosure
        label={label}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        controls={id}
      />
      <pre id={id} hidden={!expanded} {...stylex.props(messageSurface.toolText)}>
        {JSON.stringify(content.raw, null, 2)}
      </pre>
    </div>
  );
}

function ActivityGroup({
  block,
  live,
}: {
  block: Extract<AssistantTurnRenderBlock, { kind: 'activity_group' }>;
  live: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <div {...stylex.props(styles.region)} data-activity-group="">
      <Disclosure
        label={activityLabel(block.summary)}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        controls={id}
        busy={live}
      />
      <div id={id} hidden={!expanded}>
        {block.entries.map((entry) => (
          <RetainedItem key={entry.itemIndex} content={entry.content} live={live} />
        ))}
      </div>
    </div>
  );
}

function TurnSegment({
  blocks,
  workKeys,
  firstWork,
  fold,
  live,
  duration,
}: {
  blocks: readonly AssistantTurnRenderBlock[];
  workKeys: ReadonlySet<string>;
  firstWork: string | undefined;
  fold: boolean;
  live: boolean;
  duration: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const renderBlock = (block: AssistantTurnRenderBlock) =>
    block.kind === 'activity_group' ? (
      <ActivityGroup key={block.key} block={block} live={live && block === blocks.at(-1)} />
    ) : (
      <RetainedItem key={block.key} content={block.entry.content} live={live} />
    );
  return blocks.map((block) => {
    if (!fold || !workKeys.has(block.key)) return renderBlock(block);
    if (block.key !== firstWork) return null;
    return (
      <div key={block.key} data-message-process="" {...stylex.props(styles.region)}>
        <Disclosure
          label={duration ? `已工作 ${duration}` : '已完成工作'}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          controls={id}
        />
        <div id={id} hidden={!expanded}>
          {blocks.filter((item) => workKeys.has(item.key)).map(renderBlock)}
        </div>
      </div>
    );
  });
}

export function AssistantTurn({
  items,
  status,
  duration,
}: {
  items: readonly MessageContent[];
  status: 'complete' | 'streaming' | 'stopped' | 'failed';
  duration: string;
}) {
  const id = useId();
  const layout = buildAssistantTurnRenderLayout(id, items, status !== 'streaming');
  return (
    <div {...stylex.props(styles.region)} data-assistant-turn="">
      {layout.segments.map((segment) => {
        const blocks = layout.blocks.slice(...segment.blockRange);
        const hasResult = blocks.some((block) => {
          if (block.kind !== 'content' || segment.workBlockKeys.has(block.key)) return false;
          if (block.entry.content.type === 'text') return !!block.entry.content.text.trim();
          if (block.entry.content.type === 'proposed_plan')
            return !!block.entry.content.markdown.trim();
          return block.entry.content.type !== 'unsupported';
        });
        return (
          <TurnSegment
            key={segment.key}
            blocks={blocks}
            workKeys={segment.workBlockKeys}
            firstWork={layout.blocks[segment.firstWorkBlockIndex]?.key}
            fold={status === 'complete' && hasResult && segment.workBlockKeys.size > 0}
            live={status === 'streaming'}
            duration={duration}
          />
        );
      })}
    </div>
  );
}
