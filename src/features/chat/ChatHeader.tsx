import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';

import { Icon } from '../../shared/icons/Icon';
import { Button } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';
import { defaults } from '../preferences/model';
import { usePreferences } from '../preferences/use-preferences';
import { UpdateSettingsLink } from '../updates/UpdateSettingsLink';

const styles = stylex.create({
  header: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    padding: '8px 12px 6px',
    flexShrink: 0,
    minWidth: 0,
    borderBottom: `1px solid ${composer.border}`,
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
  title: {
    minWidth: 0,
    flex: '1 1 100%',
    margin: '2px 0 0',
    paddingInline: 4,
    fontSize: 18,
    lineHeight: 1.25,
    fontWeight: 650,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  navigation: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flex: '1 1 100%',
    minWidth: 0,
    overflowX: 'auto',
    paddingBlock: 2,
    scrollbarWidth: 'thin',
  },
  navLink: { flexShrink: 0 },
  current: {
    backgroundColor: composer.background,
    color: composer.label,
  },
});

const routes = [
  { path: '/account', label: '账户' },
  { path: '/settings', label: '设置' },
  { path: '/intro', label: '首次使用' },
] as const;

export function ChatHeader({ children }: { children?: ReactNode }) {
  const { preferences } = usePreferences();
  const { pathname } = useLocation();
  const current = routes.find((route) => route.path === pathname);
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
        <UpdateSettingsLink />
      </div>
      {current && <p {...stylex.props(styles.title)}>{current.label}</p>}
      {current && (
        <nav aria-label="次级页面" {...stylex.props(styles.navigation)}>
          {routes.map((route) => (
            <Button
              key={route.path}
              nativeButton={false}
              variant="ghost"
              size="small"
              aria-current={route.path === pathname ? 'page' : undefined}
              render={<NavLink to={route.path} />}
              {...stylex.props(styles.navLink, route.path === pathname && styles.current)}
            >
              {route.label}
            </Button>
          ))}
        </nav>
      )}
    </header>
  );
}
