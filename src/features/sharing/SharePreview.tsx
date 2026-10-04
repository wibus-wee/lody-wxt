import type { PreparedSharePackage, ShareAttachment, ShareHistoryEntry } from '@lody-mobile/sdk';
import { decodeShareHistoryBytes, validateShareHistory, verifyShareObject } from '@lody-mobile/sdk';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { Button } from '../../shared/ui';
import { Collapsible } from '../../shared/ui/collapsible';
import { readConversationContent } from '../../shared/ui/conversation/content';
import { MessageSurface } from '../../shared/ui/MessageSurface';
import { styles } from './styles';

function AttachmentPreview({
  prepared,
  attachment,
}: {
  prepared: PreparedSharePackage;
  attachment: ShareAttachment;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    let objectUrl = '';
    const descriptor = prepared.manifest.objects.find(
      (object) => object.id === attachment.objectId,
    );
    const bytes = prepared.objects.get(attachment.objectId);
    void (async () => {
      if (!descriptor || !bytes) throw new Error('附件缺失。');
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(descriptor.mediaType))
        throw new Error('此附件格式不支持图片预览。');
      await verifyShareObject(bytes, descriptor);
      if (!live) return;
      objectUrl = URL.createObjectURL(
        new Blob([bytes.slice().buffer], { type: descriptor.mediaType }),
      );
      setUrl(objectUrl);
    })().catch((failure) => {
      if (live) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [prepared, attachment]);
  return (
    <figure {...stylex.props(styles.figure)}>
      {url && <img src={url} alt={attachment.fileName} {...stylex.props(styles.image)} />}
      <figcaption>
        {attachment.fileName}
        {error && <output role="alert"> · {error}</output>}
      </figcaption>
    </figure>
  );
}

export function SharePreview({
  prepared,
  onReady,
}: {
  prepared: PreparedSharePackage;
  onReady: (ready: boolean) => void;
}) {
  const [conversations, setConversations] = useState<
    { id: string; title: string; history: ShareHistoryEntry[] }[]
  >([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    onReady(false);
    void Promise.all(
      prepared.manifest.objects.map(async (descriptor) => {
        const bytes = prepared.objects.get(descriptor.id);
        if (!bytes) throw new Error('分享预览缺少附件内容。');
        await verifyShareObject(bytes, descriptor);
      }),
    )
      .then(() =>
        Promise.all(
          prepared.manifest.conversations.map(async (conversation) => {
            const descriptor = prepared.manifest.objects.find(
              (object) => object.id === conversation.historyObjectId,
            );
            const bytes = prepared.objects.get(conversation.historyObjectId);
            if (!bytes || !descriptor) throw new Error('分享预览缺少会话内容。');
            await verifyShareObject(bytes, descriptor);
            const history = validateShareHistory(
              JSON.parse(
                new TextDecoder().decode(await decodeShareHistoryBytes(bytes, descriptor)),
              ),
            );
            return { id: conversation.id, title: conversation.title, history };
          }),
        ),
      )
      .then((value) => {
        if (live) {
          setConversations(value);
          onReady(true);
        }
      })
      .catch((failure) => {
        if (live) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      live = false;
    };
  }, [prepared, onReady]);
  return (
    <section aria-label="公开内容预览" {...stylex.props(styles.stack)}>
      <p {...stylex.props(styles.hint)}>
        快照时间：{new Date(prepared.manifest.capturedAt).toLocaleString()} ·{' '}
        {prepared.manifest.conversations.length} 个会话 · {prepared.manifest.attachments.length}{' '}
        个附件
      </p>
      <p {...stylex.props(styles.hint)}>
        这是将要公开的固定快照。会话之后的修改不会自动同步。文件附件按 Lody
        当前分享规则省略；消息正文与工具输出仍可能包含敏感内容，请逐项检查。
      </p>
      {error && <output role="alert">{error}</output>}
      {conversations.map((conversation) => (
        <Collapsible.Root
          key={conversation.id}
          defaultOpen={prepared.manifest.conversations.length === 1}
          {...stylex.props(styles.preview)}
        >
          <Collapsible.Trigger render={<Button variant="ghost" />}>
            {conversation.title || '未命名会话'}
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <div {...stylex.props(styles.messages)}>
              {conversation.history.map((entry) => (
                <MessageSurface
                  key={entry.id}
                  role={entry.role === 'user' ? 'user' : 'agent'}
                  status="complete"
                  text={readConversationContent(entry.items ?? [])
                    .flatMap((item) => (item.type === 'text' ? [item.text] : []))
                    .join('\n\n')}
                  content={readConversationContent(entry.items ?? [])}
                />
              ))}
            </div>
          </Collapsible.Panel>
        </Collapsible.Root>
      ))}
      <Collapsible.Root>
        <Collapsible.Trigger render={<Button variant="ghost" />}>
          查看完整公开数据
        </Collapsible.Trigger>
        <Collapsible.Panel>
          <pre {...stylex.props(styles.raw)}>
            {JSON.stringify({ manifest: prepared.manifest, conversations }, null, 2)}
          </pre>
        </Collapsible.Panel>
      </Collapsible.Root>
      {!!prepared.manifest.attachments.length && (
        <Collapsible.Root>
          <Collapsible.Trigger render={<Button variant="ghost" />}>
            附带的图片与文件
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <div {...stylex.props(styles.stack)}>
              {prepared.manifest.attachments.map((attachment) => (
                <AttachmentPreview
                  key={attachment.id}
                  attachment={attachment}
                  prepared={prepared}
                />
              ))}
            </div>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </section>
  );
}
