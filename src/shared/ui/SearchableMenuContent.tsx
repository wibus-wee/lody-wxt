import type { ReactNode } from 'react';

import { Menu } from './index';

export function SearchableMenuContent({
  children,
  className,
  alignOffset,
}: {
  children: ReactNode;
  className?: string | undefined;
  alignOffset: number;
}) {
  return (
    <Menu.Content
      side="right"
      align="start"
      alignOffset={alignOffset}
      data-lody-menu-content=""
      {...(className ? { className } : {})}
    >
      {children}
    </Menu.Content>
  );
}
