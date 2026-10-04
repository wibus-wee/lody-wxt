import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

import { Button } from '../../shared/ui';

const styles = stylex.create({ popup: { display: 'grid', gap: 12, paddingBlock: 16 } });

export function Popup({
  onOpenPanel,
  onOpenSettings,
  disabled = false,
  feedback,
}: {
  onOpenPanel: () => void;
  onOpenSettings: () => void;
  disabled?: boolean;
  feedback?: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.popup)}>
      <h2>让 Lody 陪你浏览</h2>
      <p>读懂网页，理清思路，随时问一句。</p>
      <Button onClick={onOpenPanel} disabled={disabled}>
        打开侧栏
      </Button>
      <Button variant="ghost" onClick={onOpenSettings} disabled={disabled}>
        打开设置
      </Button>
      {feedback}
    </section>
  );
}
