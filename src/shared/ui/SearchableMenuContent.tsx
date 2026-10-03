import { Menu as BaseMenu } from '@base-ui/react/menu';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

import {
  portalClassName,
  usePopupContainer,
} from '../../../vendor/lody/packages/ui/src/popup/portal-container';
import { hiddenSurfaceForSide, surface } from '../../../vendor/lody/packages/ui/src/popup/surface';
import { useForcedThemeClassNames } from '../../../vendor/lody/packages/ui/src/theme/theme';

// Lody Menu.Content's surface and positioning; search owns a dialog, choices own its menu.
export function SearchableMenuContent({
  children,
  className,
  alignOffset,
}: {
  children: ReactNode;
  className?: string | undefined;
  alignOffset: number;
}) {
  const container = usePopupContainer();
  const palette = useForcedThemeClassNames();
  return (
    <BaseMenu.Portal container={container} className={portalClassName}>
      <BaseMenu.Positioner
        side="right"
        align="start"
        alignOffset={alignOffset}
        sideOffset={4}
        collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'start' }}
        positionMethod={container ? 'absolute' : 'fixed'}
        className={[stylex.props(surface.positioner).className, ...palette]
          .filter(Boolean)
          .join(' ')}
      >
        <BaseMenu.Popup
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Base UI owns the popup's host and focus lifecycle.
          role="dialog"
          data-lody-menu-content=""
          className={(state) =>
            [
              stylex.props(
                surface.popup,
                surface.popupMenu,
                (state.transitionStatus === 'starting' || state.transitionStatus === 'ending') &&
                  hiddenSurfaceForSide(state.side),
              ).className,
              className,
            ]
              .filter(Boolean)
              .join(' ')
          }
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}
