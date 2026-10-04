import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import * as v from 'valibot';

import { button } from '../../../../vendor/lody/packages/ui/src/button/button.tokens.stylex';
import { Icon } from '../../icons/Icon';
import { composer } from '../composer.stylex';
import { Dialog } from '../dialog';
import { Badge, Button } from '../index';
import { messageSurface } from '../message.stylex';
import { MessageMarkdown } from '../MessageMarkdown';
import { ConversationContentContext } from './content-actions-context';
import type { ConversationAttachment } from './specialized-content';
import { specializedContentSchema } from './specialized-content';

const cardButtonTheme = stylex.createTheme(button, {
  heightMedium: 'auto',
  heightSmall: 'auto',
  gap: '12px',
});
const pathSeparators = /[\\/]/g;
const styles = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, paddingBlock: 4 },
  row: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  card: {
    border: `1px solid ${composer.border}`,
    borderRadius: 12,
    padding: 10,
    minWidth: 0,
    maxWidth: '100%',
    backgroundColor: composer.background,
  },
  file: {
    justifyContent: 'start',
    height: 'auto',
    width: '100%',
    minWidth: 0,
    paddingBlock: 10,
    minHeight: 58,
    gap: 12,
    textAlign: 'start',
  },
  label: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 },
  title: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  detail: { color: composer.hint, fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere' },
  image: {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '65dvh',
    objectFit: 'contain',
    borderRadius: 8,
  },
  preview: { maxHeight: '60dvh', overflow: 'auto', minWidth: 0 },
  wrap: { flexWrap: 'wrap' },
});
const goalStatus = {
  active: '进行中',
  paused: '已暂停',
  blocked: '等待处理',
  usageLimited: '用量受限',
  budgetLimited: '预算已用完',
  complete: '已完成',
  cleared: '已清除',
};
const taskStatus = {
  pending: '等待中',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
};
const planStatus = {
  pending: '待开始',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
};

function AttachmentCard({ attachment }: { attachment: ConversationAttachment }) {
  const { loadAttachment } = useContext(ConversationContentContext);
  const [open, setOpen] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const image = attachment.type === 'image';
  const fileName = attachment.fileName || '图片';
  const pending = !image && attachment.transport === 'local';
  const [openedAt] = useState(Date.now);
  const expired = !image && attachment.uploadedAt + 90 * 86400000 <= openedAt;
  const available = !!loadAttachment && !pending && !expired;
  useEffect(() => {
    if (url) return () => URL.revokeObjectURL(url);
  }, [url]);
  const load = async () => {
    if (!available || busy) return;
    setOpen(true);
    if (blob) return;
    setBusy(true);
    setError('');
    try {
      const result = await loadAttachment(attachment);
      if (!mountedRef.current) return;
      // Only approved raster formats render. HTML/SVG and executable documents remain source text or downloads.
      const safeBlob = new Blob([result], {
        type: image ? attachment.mimeType : 'application/octet-stream',
      });
      setBlob(safeBlob);
      setUrl(URL.createObjectURL(safeBlob));
      if (!image && attachment.textPreview) setPreview(await result.slice(0, 1024 * 1024).text());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    if (!url) return;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName.replaceAll(pathSeparators, '_');
    anchor.click();
  };
  return (
    <div {...stylex.props(styles.stack)} data-conversation-attachment="">
      <Button
        variant="secondary"
        disabled={!available}
        {...stylex.props(cardButtonTheme, styles.file)}
        onClick={() => void load()}
        aria-label={`打开附件 ${fileName}`}
      >
        <Icon name="page" size={24} />
        <span {...stylex.props(styles.label)}>
          <span {...stylex.props(styles.title)}>{fileName}</span>
          <span {...stylex.props(styles.detail)}>
            {pending
              ? '等待运行机器上传'
              : expired
                ? '文件已过期'
                : !loadAttachment
                  ? '附件读取暂不可用'
                  : `${new Intl.NumberFormat().format(attachment.sizeBytes)} 字节 · ${attachment.mimeType}`}
          </span>
        </span>
        {available && <Icon name="chevron" size={14} />}
      </Button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Content closeLabel="关闭预览">
          <Dialog.Title>{fileName}</Dialog.Title>
          <Dialog.Description>{image ? '图片预览' : attachment.mimeType}</Dialog.Description>
          {busy && <output>正在读取附件…</output>}
          {error && (
            <div role="alert" {...stylex.props(styles.stack)}>
              <span {...stylex.props(messageSurface.error)}>{error}</span>
              <Button size="small" onClick={() => void load()}>
                重试读取
              </Button>
            </div>
          )}
          {url && image && <img src={url} alt={fileName} {...stylex.props(styles.image)} />}
          {blob && !image && attachment.textPreview && (
            <div {...stylex.props(styles.preview)}>
              <pre {...stylex.props(messageSurface.toolText)}>{preview}</pre>
              {blob.size > 1024 * 1024 && (
                <p {...stylex.props(styles.detail)}>仅预览前 1 MiB，下载可获取完整文件。</p>
              )}
            </div>
          )}
          {blob && !image && !attachment.textPreview && (
            <p {...stylex.props(styles.detail)}>此文件可下载后查看。</p>
          )}
          {blob && (
            <Button size="small" onClick={download}>
              下载文件
            </Button>
          )}
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}

export function SpecializedContent({
  raw,
  renderSubagent,
}: {
  raw: unknown;
  renderSubagent: (items: readonly unknown[]) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const disclosureId = useId();
  const actions = useContext(ConversationContentContext);
  const parsed = v.safeParse(specializedContentSchema, raw);
  if (!parsed.success) return null;
  const content = parsed.output;
  switch (content.type) {
    case 'file':
      return <AttachmentCard key={content.fileId} attachment={content} />;
    case 'image':
      return <AttachmentCard key={content.imageId} attachment={content} />;
  }
  if (content.type === 'image_group')
    return (
      <div {...stylex.props(styles.stack)}>
        {content.images.map((item) => (
          <AttachmentCard key={item.imageId} attachment={{ ...item, type: 'image' }} />
        ))}
      </div>
    );
  if (content.type === 'goal')
    return (
      <div {...stylex.props(styles.row, styles.detail)}>
        <Icon name="plan" size={14} />
        <span>
          {goalStatus[content.status]} · {content.objective}
        </span>
      </div>
    );
  if (content.type === 'plan')
    return (
      <section {...stylex.props(styles.stack)} aria-label="执行计划">
        {content.entries.map((entry, index) => (
          <div key={index} {...stylex.props(styles.card, styles.row)}>
            <Icon name={entry.status === 'completed' ? 'check' : 'plan'} size={16} />
            <span {...stylex.props(styles.label)}>
              {entry.content}
              <span {...stylex.props(styles.detail)}>{planStatus[entry.status ?? 'pending']}</span>
            </span>
            {entry.priority && (
              <Badge
                tone={
                  entry.priority === 'high'
                    ? 'danger'
                    : entry.priority === 'medium'
                      ? 'warning'
                      : 'success'
                }
              >
                {entry.priority === 'high' ? '高' : entry.priority === 'medium' ? '中' : '低'}
              </Badge>
            )}
          </div>
        ))}
      </section>
    );
  if (content.type === 'available_commands')
    return (
      <section {...stylex.props(styles.stack)} aria-label="可用指令">
        {content.commands.map((command) => (
          <Button
            key={command.name}
            variant="ghost"
            size="small"
            disabled={!actions.onCommand}
            {...stylex.props(cardButtonTheme, styles.file)}
            onClick={() => actions.onCommand?.(`/${command.name}`)}
          >
            <span {...stylex.props(styles.label)}>
              <span>/{command.name}</span>
              {command.description && (
                <span {...stylex.props(styles.detail)}>{command.description}</span>
              )}
            </span>
          </Button>
        ))}
      </section>
    );
  if (content.type === 'subagent_task')
    return (
      <div {...stylex.props(styles.card, styles.stack)} data-subagent-task="">
        <div {...stylex.props(styles.row)}>
          <Icon name="agent" size={16} />
          <span {...stylex.props(styles.label)}>
            {content.description || content.actor || '子 Agent'}
            <span {...stylex.props(styles.detail)}>{taskStatus[content.status]}</span>
          </span>
        </div>
        {content.summary && <MessageMarkdown value={content.summary} compact />}
        {content.error && (
          <p role="alert" {...stylex.props(messageSurface.error)}>
            {content.error}
          </p>
        )}
        {content.run && content.run.items.length > 0 && (
          <>
            <Button
              variant="ghost"
              size="small"
              aria-expanded={expanded}
              aria-controls={disclosureId}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '收起工作记录' : '展开工作记录'}
            </Button>
            <div id={disclosureId} hidden={!expanded}>
              {renderSubagent(content.run.items)}
            </div>
          </>
        )}
        {content.run && actions.onOpenSubagent && (
          <Button
            variant="ghost"
            size="small"
            onClick={() => actions.onOpenSubagent?.(content.run!.sessionId)}
          >
            查看子会话
          </Button>
        )}
      </div>
    );
  if (content.type === 'system_notice') {
    const label =
      content.name === 'chat_failed'
        ? '回复未完成'
        : content.name === 'agent_warning'
          ? 'Agent 提示'
          : content.name === 'session_fork_origin'
            ? `分叉自 ${content.meta?.sourceTitle || '另一段会话'}`
            : '已恢复历史对话';
    return (
      <div
        {...stylex.props(styles.stack, styles.detail)}
        role={content.name === 'chat_failed' ? 'alert' : 'note'}
      >
        <div {...stylex.props(styles.row)}>
          <Icon name="info" size={14} />
          <span>{label}</span>
        </div>
        {(content.meta?.message || content.meta?.error) && (
          <span>{content.meta.message || content.meta.error}</span>
        )}
        {content.meta?.truncated && <span>历史内容已截断。</span>}
        <Button
          variant="ghost"
          size="small"
          aria-expanded={expanded}
          aria-controls={disclosureId}
          onClick={() => setExpanded(!expanded)}
        >
          技术详情
        </Button>
        <pre id={disclosureId} hidden={!expanded} {...stylex.props(messageSurface.toolText)}>
          {JSON.stringify(raw, null, 2)}
        </pre>
      </div>
    );
  }
  return null;
}
