import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

import { Popover } from './index';

const styles = stylex.create({
  title: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' },
});

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
    <Popover.Content
      side="right"
      align="start"
      alignOffset={alignOffset}
      data-lody-menu-content=""
      {...(className ? { className } : {})}
    >
      <Popover.Title {...stylex.props(styles.title)}>选择模型</Popover.Title>
      {children}
    </Popover.Content>
  );
}
