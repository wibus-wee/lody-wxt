import { colors } from '@lody/ui/tokens/colors.stylex';
import { space, text } from '@lody/ui/tokens/scales.stylex';
import * as stylex from '@stylexjs/stylex';
import type { RefObject } from 'react';

import { Icon } from '../../shared/icons/Icon';
import { Button } from '../../shared/ui';
import { Dialog } from '../../shared/ui/dialog';

export type PageSource = 'page' | 'selection' | 'video' | 'link' | 'library' | 'pdf';

const sources: {
  title: string;
  choices: { id: PageSource; label: string; opensPanel?: boolean }[];
}[] = [
  {
    title: '当前页面',
    choices: [
      { id: 'page', label: '附加当前页面' },
      { id: 'selection', label: '附加选中文字' },
      { id: 'video', label: '附加视频字幕' },
    ],
  },
  {
    title: '其他来源',
    choices: [
      { id: 'link', label: '附加链接…', opensPanel: true },
      { id: 'library', label: '书签与浏览历史…', opensPanel: true },
      { id: 'pdf', label: '读取 PDF 文字…', opensPanel: true },
    ],
  },
];
const styles = stylex.create({
  groups: { display: 'flex', flexDirection: 'column', gap: space[3] },
  group: { display: 'grid', gap: space[1] },
  heading: {
    margin: 0,
    paddingInline: space[2],
    paddingBottom: space[1],
    color: colors.secondaryLabel,
    fontSize: text.footnoteSize,
    fontWeight: 500,
  },
  label: { flex: 1, minWidth: 0, textAlign: 'start' },
  note: {
    margin: 0,
    paddingInline: space[2],
    color: colors.secondaryLabel,
    fontSize: text.footnoteSize,
    lineHeight: text.footnoteLeading,
  },
});

export function SourcePickerDialog({
  onSelect,
  onClose,
  maxRemaining,
  documentAvailable,
  finalFocus,
}: {
  onSelect: (source: PageSource) => void;
  onClose: () => void;
  maxRemaining: number;
  documentAvailable: boolean;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content width={360} closeLabel="关闭资料来源" finalFocus={finalFocus}>
        <Dialog.Title>其他资料来源</Dialog.Title>
        <Dialog.Description>选择要加入草稿的资料，发送前仍可检查和移除。</Dialog.Description>
        <div {...stylex.props(styles.groups)}>
          {sources.map((group) => (
            <section key={group.title} aria-label={group.title} {...stylex.props(styles.group)}>
              <h3 {...stylex.props(styles.heading)}>{group.title}</h3>
              {group.choices.map((choice) => (
                <Button
                  key={choice.id}
                  variant="ghost"
                  size="small"
                  disabled={choice.id === 'pdf' ? !documentAvailable : maxRemaining < 1}
                  onClick={() => onSelect(choice.id)}
                >
                  <span {...stylex.props(styles.label)}>{choice.label}</span>
                  {choice.opensPanel && <Icon name="chevron" size={14} />}
                </Button>
              ))}
            </section>
          ))}
          {maxRemaining < 1 && (
            <p {...stylex.props(styles.note)}>网页资料已达上限，请先移除不需要的资料。</p>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
