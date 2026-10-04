import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { popup } from '../../../vendor/lody/packages/ui/src/popup/popup.tokens.stylex';
import { Icon } from '../icons/Icon';
import { composerSurface as surface } from './composer';
import { Button, Menu, Tooltip } from './index';

const theme = stylex.createTheme(popup, { menuWidth: '176px' });
const styles = stylex.create({
  iconOnly: { flexShrink: 0, width: 28, gap: 0, paddingInline: 0, justifyContent: 'center' },
  menu: { width: 'max-content', minWidth: 176, maxWidth: 256 },
  description: { maxWidth: 288, whiteSpace: 'pre-wrap' },
});

export interface PermissionOption {
  value: string;
  label: string;
  description?: string | undefined;
  disabled?: boolean | undefined;
  icon: 'permission' | 'readOnly' | 'permissionWarning';
  warning?: boolean | undefined;
}

// Copied from Lody DesktopPermissionModeButton; callers own capability data and selection.
export function PermissionModeMenu({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly PermissionOption[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!options.length) return null;
  const selected = options.find((option) => option.value === value);
  const label = selected ? `权限：${selected.label}` : '权限';
  const glyph = (option?: PermissionOption) => (
    <span {...stylex.props(option?.warning && surface.faceWarning)}>
      <Icon name={option?.icon ?? 'permission'} size={14} />
    </span>
  );
  return (
    <Menu.Root open={open && !disabled} onOpenChange={setOpen}>
      <Menu.Trigger
        disabled={disabled}
        aria-label={label}
        title={label}
        data-permission-trigger=""
        render={<Button type="button" variant="ghost" size="small" icon aria-label={label} />}
      >
        <span {...stylex.props(surface.glyph)}>{glyph(selected)}</span>
      </Menu.Trigger>
      <Menu.Content
        align="start"
        {...stylex.props(styles.menu, theme)}
        finalFocus={() =>
          document.querySelector<HTMLTextAreaElement>('[data-keyboard-nav="composer"]')
        }
      >
        <div {...stylex.props(surface.menuList)}>
          {options.map((option) => {
            const item = (
              <Menu.Item
                disabled={option.disabled}
                role="menuitemradio"
                aria-checked={option.value === value}
                onClick={() => onChange(option.value)}
                icon={glyph(option)}
                endContent={option.value === value ? <Icon name="check" size={14} /> : null}
              >
                {option.label}
              </Menu.Item>
            );
            return option.description ? (
              <Tooltip.Root key={option.value}>
                <Tooltip.Trigger delay={300} render={item} />
                <Tooltip.Content side="right" align="start" {...stylex.props(styles.description)}>
                  {option.description}
                </Tooltip.Content>
              </Tooltip.Root>
            ) : (
              <span key={option.value} role="none">
                {item}
              </span>
            );
          })}
        </div>
      </Menu.Content>
    </Menu.Root>
  );
}
