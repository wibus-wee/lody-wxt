import * as v from 'valibot';
import { browser } from 'wxt/browser';

import { captureVisiblePage, cropScreenshot } from './screenshot';
import { screenshotPortName, screenshotSelectionSchema } from './screenshot-protocol';

export async function captureAndCropVisiblePage(signal: AbortSignal): Promise<File | null> {
  signal.throwIfAborted();
  const screenshot = await captureVisiblePage();
  // The initiating extension surface loads CSS; no web-accessible resources or host grants are needed.
  const cssResponse = await fetch(
    new URL('content-scripts/screenshot.css', browser.runtime.getURL('/')),
  );
  if (!cssResponse.ok) throw new Error('截图工具样式加载失败，请重新打开扩展后重试。');
  const css = await cssResponse.text();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(screenshot.file);
  });
  signal.throwIfAborted();
  // Injection follows capture so the crop tool never appears in the captured pixels.
  const [injected] = await browser.scripting.executeScript({
    target: { tabId: screenshot.tabId, frameIds: [0] },
    files: ['/content-scripts/screenshot.js'],
  });
  signal.throwIfAborted();
  if (!injected?.documentId) throw new Error('无法在来源网页打开截图工具，请重试。');
  const selection = await new Promise<v.InferOutput<typeof screenshotSelectionSchema>>(
    (resolve, reject) => {
      const port = browser.tabs.connect(screenshot.tabId, {
        name: screenshotPortName,
        documentId: injected.documentId,
      });
      function finish(error?: Error, value?: v.InferOutput<typeof screenshotSelectionSchema>) {
        signal.removeEventListener('abort', abort);
        port.onMessage.removeListener(receive);
        port.onDisconnect.removeListener(disconnect);
        port.disconnect();
        if (error) reject(error);
        else if (value) resolve(value);
      }
      function abort() {
        finish(new DOMException('Draft context changed', 'AbortError'));
      }
      function disconnect() {
        finish(new Error('来源网页或截图工具已关闭，没有附加截图。'));
      }
      function receive(message: unknown) {
        const parsed = v.safeParse(screenshotSelectionSchema, message);
        if (!parsed.success) finish(new Error('截图工具返回了无效结果，没有附加截图。'));
        else if (parsed.output.type === 'error') finish(new Error(parsed.output.message));
        else finish(undefined, parsed.output);
      }
      port.onMessage.addListener(receive);
      port.onDisconnect.addListener(disconnect);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      port.postMessage({
        data,
        css,
        width: screenshot.width,
        height: screenshot.height,
        viewport: screenshot.viewport,
      });
    },
  );
  signal.throwIfAborted();
  if (selection.type === 'crop') return cropScreenshot(screenshot, selection.region);
  return selection.type === 'full' ? screenshot.file : null;
}
