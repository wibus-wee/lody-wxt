import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { Icon } from '../../shared/icons/Icon';
import { Button, Menu } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';

const styles = stylex.create({
  error: { fontSize: 12, color: composer.hint, overflowWrap: 'anywhere', maxWidth: '100%' },
});
export function MessageActions({
  onEdit,
  onRegenerate,
  onFork,
  disabled = false,
}: {
  onEdit?: (() => void | Promise<void>) | undefined;
  onRegenerate?: (() => void | Promise<void>) | undefined;
  onFork?: (() => void | Promise<void>) | undefined;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  if (!onEdit && !onRegenerate && !onFork) return null;
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          render={
            <Button
              variant="ghost"
              size="small"
              icon
              disabled={disabled || busy}
              aria-label="消息操作"
            />
          }
        >
          <Icon name="chevron" size={14} />
        </Menu.Trigger>
        <Menu.Content>
          {onEdit && <Menu.Item onClick={() => void run(onEdit)}>编辑并重发…</Menu.Item>}
          {onRegenerate && <Menu.Item onClick={() => void run(onRegenerate)}>重新生成</Menu.Item>}
          {onFork && <Menu.Item onClick={() => void run(onFork)}>从这里分叉</Menu.Item>}
        </Menu.Content>
      </Menu.Root>
      {error && (
        <output role="alert" {...stylex.props(styles.error)}>
          {error}
        </output>
      )}
    </>
  );
}
