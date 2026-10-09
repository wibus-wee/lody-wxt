import * as stylex from '@stylexjs/stylex';
import { NavLink } from 'react-router';

import { Icon } from '../../shared/icons/Icon';
import { Button, Tooltip } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';
import { availableRelease } from './appcast';
import { useUpdates } from './use-updates';

const styles = stylex.create({
  icon: { position: 'relative', display: 'inline-flex' },
  marker: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: composer.label,
    border: `1px solid ${composer.canvas}`,
    pointerEvents: 'none',
  },
});

export function UpdateSettingsLinkView({
  version,
  previousCheckFailed = false,
}: {
  version: string | null;
  previousCheckFailed?: boolean;
}) {
  const hint = version
    ? `${previousCheckFailed ? '上次确认有新版' : '有新版'} ${version}，打开设置查看更新。`
    : '设置';
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Button
            nativeButton={false}
            variant="ghost"
            size="small"
            icon
            aria-label="Settings"
            aria-description={version ? hint : undefined}
            data-update-version={version ?? undefined}
            render={<NavLink to="/settings" />}
          />
        }
      >
        <span {...stylex.props(styles.icon)}>
          <Icon name="settings" size={18} />
          {version && <span aria-hidden="true" {...stylex.props(styles.marker)} />}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content>{hint}</Tooltip.Content>
    </Tooltip.Root>
  );
}

export function UpdateSettingsLink() {
  const { installedVersion, state, error } = useUpdates();
  const release = installedVersion && state ? availableRelease(state, installedVersion) : null;
  const version = release && state?.skippedVersion !== release.version ? release.version : null;
  return (
    <UpdateSettingsLinkView
      version={version}
      previousCheckFailed={Boolean(error ?? state?.error)}
    />
  );
}
