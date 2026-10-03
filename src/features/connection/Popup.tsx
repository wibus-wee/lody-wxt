import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { NavLink } from 'react-router';
import { browser } from 'wxt/browser';

import { isExtension } from '../../shared/storage';
import { Alert, Button } from '../../shared/ui';

const styles = stylex.create({ popup: { display: 'grid', gap: 20, paddingBlock: 24 } });
export function Popup() {
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(false);
  const openPanel = () => {
    // Invoke sidePanel.open in the actual click turn to preserve Chrome's user activation.
    void browser.windows
      .getCurrent()
      .then((window) => {
        if (window.id === undefined) throw new Error('没有可用的浏览器窗口。');
        return browser.sidePanel.open({ windowId: window.id });
      })
      .then(() => setOpened(true))
      .catch(() => setError('无法打开侧栏，请使用 Chrome 工具栏的侧栏入口。'));
  };
  return (
    <section {...stylex.props(styles.popup)}>
      <h2>让 Lody 陪你浏览</h2>
      <p>在侧栏继续会话，主动附加网页与选中文字。</p>
      <Button onClick={openPanel} disabled={!isExtension()}>
        打开侧栏
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          if (isExtension())
            void browser.runtime.openOptionsPage().catch(() => setError('无法打开设置。'));
        }}
        disabled={!isExtension()}
      >
        打开设置
      </Button>
      {!isExtension() && <NavLink to="/">网页预览</NavLink>}
      {opened && <output>侧栏已打开</output>}
      {error && (
        <Alert.Root tone="danger">
          <Alert.Description>{error}</Alert.Description>
        </Alert.Root>
      )}
    </section>
  );
}
