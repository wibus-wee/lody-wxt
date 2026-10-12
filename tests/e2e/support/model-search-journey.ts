import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

import type { JourneyEvidence } from '../../../tools/assurance/evidence';

/** Interact only with rendered controls; callers provide real HTTP/Streams capabilities. */
export async function searchConfigModel(
  page: Page,
  evidence: JourneyEvidence,
  capture: (name: string) => Promise<void>,
) {
  const trigger = page.getByRole('button', { name: '运行配置', exact: true });
  const input = page.getByRole('textbox', { name: '搜索模型', exact: true });
  const open = async () => {
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Model Controlled model', exact: true }).click();
  };
  await open();
  await capture('unfiltered-models');
  await evidence.check('searchable-config-models', async () => {
    await expect(input).toBeVisible();
    await input.fill('provider/model-29');
    await expect(
      page.getByRole('menuitemradio', { name: 'Research model 29', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitemradio', { name: 'Controlled model', exact: true }),
    ).toHaveCount(0);
    const box = await input.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await capture('filtered-model');
  });
  await evidence.check('empty-search-recovers', async () => {
    await input.fill('no-such-model-zzzz');
    await expect(page.getByRole('status', { name: '模型选项', exact: true })).toHaveText(
      '没有匹配的模型',
    );
    await input.press('Enter');
    await expect(trigger).toContainText('Controlled model');
    await input.fill('');
    await expect(
      page.getByRole('menuitemradio', { name: 'Controlled model', exact: true }),
    ).toBeVisible();
    await input.press('Escape');
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await open();
    await expect(input).toHaveValue('');
  });
  await evidence.check('selection-survives-reopen', async () => {
    await input.fill('Research 29');
    await input.press('ArrowDown');
    const option = page.getByRole('menuitemradio', { name: 'Research model 29', exact: true });
    await expect(option).toBeFocused();
    await option.press('Enter');
    await expect(trigger).toContainText('Research model 29');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Model Research model 29', exact: true }).click();
    await expect(option).toHaveAttribute('aria-checked', 'true');
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    await capture('selected-model');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
}
