import type { Page } from '@playwright/test';

export function configureCaptureClock(page: Page, surface: 'web' | 'extension'): Promise<void>;
