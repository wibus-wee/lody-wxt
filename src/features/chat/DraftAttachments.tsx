import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { button } from '../../../vendor/lody/packages/ui/src/button/button.tokens.stylex';
import { Icon } from '../../shared/icons/Icon';
import { Button } from '../../shared/ui';
import { Card } from '../../shared/ui/card';
import { composer } from '../../shared/ui/composer.stylex';
import { Dialog } from '../../shared/ui/dialog';
import type { DraftAttachment } from './attachment-drafts';

const previewButton = stylex.createTheme(button, { heightSmall: 'auto' });
const styles = stylex.create({
  strip: { display: 'flex', gap: 8, overflowX: 'auto', padding: 4, minWidth: 0 },
  card: { width: 112, flexShrink: 0, gap: 4, padding: 8 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    fontSize: 12,
  },
  image: { width: 64, height: 48, objectFit: 'cover' },
  preview: { maxWidth: '100%', maxHeight: '60dvh', objectFit: 'contain' },
  detail: { fontSize: 11, color: composer.hint },
});

function DraftAttachmentItem({
  item,
  disabled,
  percent,
  phase,
  remove,
}: {
  item: DraftAttachment;
  disabled: boolean;
  percent?: number | undefined;
  phase?: 'preparing' | 'uploading' | 'verifying' | undefined;
  remove: () => void;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']).has(item.mimeType)) return;
    const next = URL.createObjectURL(item.source);
    let active = true;
    queueMicrotask(() => {
      if (active) setUrl(next);
    });
    return () => {
      active = false;
      URL.revokeObjectURL(next);
    };
  }, [item.source, item.mimeType]);
  return (
    <Card.Root {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.row)}>
        {url ? (
          <Dialog.Root>
            <Dialog.Trigger
              render={
                <Button
                  size="small"
                  variant="ghost"
                  {...stylex.props(previewButton)}
                  aria-label={`预览 ${item.name}`}
                />
              }
            >
              <img src={url} alt={item.name} {...stylex.props(styles.image)} />
            </Dialog.Trigger>
            <Dialog.Content>
              <Dialog.Title>{item.name}</Dialog.Title>
              <Dialog.Description>即将附加的图片</Dialog.Description>
              <img src={url} alt={item.name} {...stylex.props(styles.preview)} />
            </Dialog.Content>
          </Dialog.Root>
        ) : (
          <Icon name="page" size={20} />
        )}
        <Button
          type="button"
          variant="ghost"
          size="small"
          icon
          disabled={disabled}
          onClick={remove}
          aria-label={`移除 ${item.name}`}
        >
          <Icon name="close" size={12} />
        </Button>
      </div>
      <span title={item.name} {...stylex.props(styles.name)}>
        {item.name}
      </span>
      <span {...stylex.props(styles.detail)}>
        {percent !== undefined
          ? `${phase === 'preparing' ? '准备' : phase === 'verifying' ? '校验' : '上传'} ${percent}%`
          : item.ready
            ? '已上传'
            : `${Math.ceil(item.source.size / 1024)} KiB · 草稿`}
      </span>
    </Card.Root>
  );
}

export function DraftAttachments({
  items,
  disabled,
  progress,
  onRemove,
}: {
  items: readonly DraftAttachment[];
  disabled: boolean;
  progress?:
    | { id: string; percent: number; phase: 'preparing' | 'uploading' | 'verifying' }
    | undefined;
  onRemove: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div {...stylex.props(styles.strip)} aria-label="待发送附件">
      {items.map((item) => (
        <DraftAttachmentItem
          key={item.id}
          item={item}
          disabled={disabled}
          percent={progress?.id === item.id ? progress.percent : undefined}
          phase={progress?.id === item.id ? progress.phase : undefined}
          remove={() => onRemove(item.id)}
        />
      ))}
    </div>
  );
}
