import { MotionConfig } from 'motion/react';
import { createRoot } from 'react-dom/client';
import * as v from 'valibot';
import type { Browser } from 'wxt/browser';
import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';

import { installFocusModality, ThemeRoot } from '../../shared/ui';
import { screenshotOverlaySchema, screenshotPortName } from './screenshot-protocol';
import { ScreenshotOverlay } from './ScreenshotOverlay';

export function registerScreenshotOverlay(ctx: ContentScriptContext) {
  const connect = (port: Browser.runtime.Port) => {
    if (port.name !== screenshotPortName || port.sender?.id !== browser.runtime.id) return;
    let live = true;
    let remove: (() => void) | undefined;
    const disconnect = () => {
      live = false;
      remove?.();
      port.disconnect();
    };
    const stop = ctx.onInvalidated(disconnect);
    port.onDisconnect.addListener(() => {
      stop();
      live = false;
      remove?.();
    });
    // Extension ports deliver untyped messages; decoding happens before mounting the UI.
    // ast-grep-ignore: no-unknown-parameter
    const receive = (message: unknown) => {
      port.onMessage.removeListener(receive);
      void (async () => {
        try {
          const input = v.parse(screenshotOverlaySchema, message);
          const source = input.viewport;
          if (
            location.href !== source.url ||
            performance.timeOrigin !== source.document ||
            scrollX !== source.x ||
            scrollY !== source.y ||
            innerWidth !== source.width ||
            innerHeight !== source.height ||
            devicePixelRatio !== source.scale
          )
            throw new Error('页面在打开截图工具前发生变化，请重新截图。');
          const focused = document.activeElement;
          const ui = await createShadowRootUi(ctx, {
            name: 'lody-screenshot',
            position: 'modal',
            anchor: document.documentElement,
            zIndex: 2_147_483_647,
            css: input.css.replaceAll(':root', ':host'),
            isolateEvents: [
              'keydown',
              'keyup',
              'keypress',
              'pointerdown',
              'pointerup',
              'click',
              'wheel',
            ],
            onMount(container, _shadow, host) {
              host.setAttribute('popover', 'manual');
              host.showPopover();
              const uninstallFocus = installFocusModality();
              const root = createRoot(container);
              root.render(
                <MotionConfig
                  reducedMotion="user"
                  transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                >
                  <ThemeRoot mode="system">
                    <ScreenshotOverlay
                      data={input.data}
                      width={input.width}
                      height={input.height}
                      onSelect={(selection) => port.postMessage(selection)}
                    />
                  </ThemeRoot>
                </MotionConfig>,
              );
              return { root, uninstallFocus };
            },
            onRemove(mounted) {
              mounted?.root.unmount();
              mounted?.uninstallFocus();
              if (focused instanceof HTMLElement && focused.isConnected)
                focused.focus({ preventScroll: true });
            },
          });
          remove = ui.remove;
          if (!live || ctx.isInvalid) return;
          ui.mount();
        } catch (cause) {
          if (live)
            port.postMessage({
              type: 'error',
              message: cause instanceof Error ? cause.message : '网页截图工具无法打开。',
            });
        }
      })();
    };
    port.onMessage.addListener(receive);
  };
  browser.runtime.onConnect.addListener(connect);
  ctx.onInvalidated(() => browser.runtime.onConnect.removeListener(connect));
}
