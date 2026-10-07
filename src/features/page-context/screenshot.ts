import * as v from 'valibot';
import { browser } from 'wxt/browser';

import { authorizedCaptureTab } from './capture';

export const screenshotViewportSchema = v.object({
  url: v.string(),
  document: v.number(),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
  scale: v.number(),
  sensitive: v.boolean(),
});

export interface Screenshot {
  file: File;
  width: number;
  height: number;
  capturedAt: string;
  tabId: number;
  viewport: v.InferOutput<typeof screenshotViewportSchema>;
}

export interface ScreenshotRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function captureVisiblePage(): Promise<Screenshot> {
  const tabId = await authorizedCaptureTab();
  const tab = await browser.tabs.get(tabId);
  const read = async () => {
    const active = (await browser.tabs.query({ active: true, windowId: tab.windowId }))[0];
    if (active?.id !== tabId) throw new Error('当前标签页已变化，截图已取消。');
    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => ({
        url: location.href,
        document: performance.timeOrigin,
        x: scrollX,
        y: scrollY,
        width: innerWidth,
        height: innerHeight,
        scale: devicePixelRatio,
        sensitive: [
          ...document.querySelectorAll(
            'input[type="password"],input[autocomplete="one-time-code"],[data-sensitive]',
          ),
        ].some((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < innerHeight &&
            rect.left < innerWidth
          );
        }),
      }),
    });
    return v.parse(screenshotViewportSchema, result?.result);
  };
  const before = await read();
  if (before.sensitive) throw new Error('当前可见区域包含密码、验证码或敏感内容，请隐藏后再截图。');
  let data: string;
  try {
    data = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('activeTab'))
      throw new Error(
        '请先在目标网页点击工具栏的 Lody 图标，授予这一个标签页的临时截图权限，然后重试。',
      );
    throw cause;
  }
  const after = await read();
  const fields = ['url', 'document', 'x', 'y', 'width', 'height', 'scale', 'sensitive'] as const;
  if (fields.some((field) => before[field] !== after[field]))
    throw new Error('页面在截图期间发生变化，请保持页面静止后重试。');
  const blob = await (await fetch(data)).blob();
  const bitmap = await createImageBitmap(blob);
  const result: Screenshot = {
    file: new File([blob], '页面截图.png', { type: 'image/png' }),
    width: bitmap.width,
    height: bitmap.height,
    capturedAt: new Date().toISOString(),
    tabId,
    viewport: before,
  };
  bitmap.close();
  return result;
}

export async function cropScreenshot(
  screenshot: Screenshot,
  region: ScreenshotRegion,
): Promise<File> {
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isInteger) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width < 1 ||
    region.height < 1 ||
    region.x + region.width > screenshot.width ||
    region.y + region.height > screenshot.height
  )
    throw new Error('裁剪范围必须在截图内，且宽高至少为 1 像素。');
  const image = await createImageBitmap(screenshot.file);
  const canvas = new OffscreenCanvas(region.width, region.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持图像裁剪。');
  context.drawImage(
    image,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height,
  );
  image.close();
  return new File([await canvas.convertToBlob({ type: 'image/png' })], '区域截图.png', {
    type: 'image/png',
  });
}
