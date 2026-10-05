import * as stylex from '@stylexjs/stylex';

import { Icon } from '../../shared/icons/Icon';
import { Button, Tooltip } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';

const styles = stylex.create({
  row: { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 },
  control: { fontSize: 12, fontWeight: 400, color: composer.hint, gap: 6 },
});

export function ComposerContextBar({
  currentPage,
  onCurrentPageChange,
  onSelectTabs,
  disabled = false,
  full = false,
}: {
  currentPage: boolean;
  onCurrentPageChange: (value: boolean) => void;
  onSelectTabs: () => void;
  disabled?: boolean;
  full?: boolean;
}) {
  return (
    <section {...stylex.props(styles.row)} aria-label="网页范围">
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              type="button"
              variant={currentPage ? 'secondary' : 'ghost'}
              size="mini"
              {...stylex.props(styles.control)}
              disabled={disabled || (full && !currentPage)}
              aria-label="发送时读取当前页面"
              aria-pressed={currentPage}
              onClick={() => onCurrentPageChange(!currentPage)}
            />
          }
        >
          <Icon name="page" size={14} />
          当前页面
          {currentPage && <Icon name="check" size={12} />}
        </Tooltip.Trigger>
        <Tooltip.Content>
          {currentPage ? '已开启：发送时读取当前页面' : '开启后，发送时读取当前页面'}
        </Tooltip.Content>
      </Tooltip.Root>
      <Button
        type="button"
        variant="ghost"
        size="mini"
        {...stylex.props(styles.control)}
        aria-label="选择标签页"
        disabled={disabled || full}
        onClick={onSelectTabs}
      >
        标签页
        <Icon name="chevron" size={12} />
      </Button>
    </section>
  );
}
