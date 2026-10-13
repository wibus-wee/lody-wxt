import type { BrowserContext, Page, expect } from '@playwright/test';

export function configureCaptureClock(page: Page, surface: 'web' | 'extension'): Promise<void>;
export function captureSourceScreenshot(
  context: BrowserContext,
  panel: Page,
  outcome: 'blocked' | 'overlay',
  assertion: typeof expect,
): Promise<Page>;
