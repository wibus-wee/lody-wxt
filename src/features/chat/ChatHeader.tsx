import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

import { Icon } from '../../shared/icons/Icon';
import { Button, Tooltip } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';
import { defaults } from '../preferences/model';
import { usePreferences } from '../preferences/use-preferences';

const styles = stylex.create({
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '10px 12px',
    flexShrink: 0,
    minWidth: 0,
  },
  brand: {
    color: composer.label,
    margin: 0,
    fontSize: 16,
    fontWeight: 650,
    letterSpacing: '-0.3px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  home: { color: composer.label, minWidth: 0, flexShrink: 1 },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    marginInlineStart: 'auto',
    minWidth: 0,
  },
});

export function ChatHeader({ children }: { children?: ReactNode }) {
  const { preferences } = usePreferences();
  return (
    <header {...stylex.props(styles.header)}>
      <Button
        nativeButton={false}
        variant="ghost"
        size="small"
        aria-label="Workspace"
        render={<NavLink to="/" />}
        {...stylex.props(styles.home)}
      >
        <Icon name="lody" size={18} />
        <h1 {...stylex.props(styles.brand)}>
          {preferences.displayName === defaults.displayName ? 'Lody' : preferences.displayName}
        </h1>
      </Button>
      <div {...stylex.props(styles.actions)}>
        {children}
        <Tooltip.Root>
          <Tooltip.Trigger
            render={
              <Button
                nativeButton={false}
                variant="ghost"
                size="small"
                icon
                aria-label="Settings"
                render={<NavLink to="/settings" />}
              />
            }
          >
            <Icon name="settings" size={18} />
          </Tooltip.Trigger>
          <Tooltip.Content>设置</Tooltip.Content>
        </Tooltip.Root>
      </div>
    </header>
  );
}
