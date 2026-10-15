// Real browser tests for the Node capture controller, not application components.
import assert from 'node:assert/strict';
import process from 'node:process';
import { after, before, test } from 'node:test';

import { chromium, expect } from '@playwright/test';

import { selectCaptureTheme } from './capture-ui.mjs';

let browser;
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CAPTURE_TEST_CHROMIUM });
});
after(async () => {
  await browser?.close();
});

async function fixture({
  categorized = false,
  hidden = false,
  delayed = false,
  broken = false,
} = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(1000);
  await page.setContent('<main data-theme="system"></main>');
  await page.evaluate(
    ({ categorized, hidden, delayed, broken }) => {
      const mount = () => {
        const main = document.querySelector('main');
        main.innerHTML = `${categorized ? '<nav aria-label="设置分类"><button>通用 外观与浏览器快捷键</button></nav>' : ''}
        <section ${hidden ? 'hidden' : ''}><button role="combobox" aria-label="主题">主题</button>
        <div role="listbox" hidden><button role="option">浅色</button><button role="option">深色</button></div></section>`;
        const panel = main.querySelector('section');
        main.querySelector('nav button')?.addEventListener('click', () => {
          panel.hidden = false;
        });
        main.querySelector('[role="combobox"]').addEventListener('click', () => {
          main.querySelector('[role="listbox"]').hidden = false;
        });
        for (const option of main.querySelectorAll('[role="option"]')) {
          option.addEventListener('click', () => {
            if (!broken) main.dataset.theme = option.textContent === '浅色' ? 'light' : 'dark';
          });
        }
      };
      if (delayed) setTimeout(mount, 100);
      else mount();
    },
    { categorized, hidden, delayed, broken },
  );
  return page;
}

for (const theme of ['light', 'dark']) {
  for (const [layout, options] of [
    ['flat', {}],
    ['wide categories', { categorized: true }],
    ['narrow categories', { categorized: true, hidden: true }],
    ['hydrating category list', { categorized: true, hidden: true, delayed: true }],
    ['hydrating flat settings', { delayed: true }],
  ]) {
    test(`sets ${theme} through the actual control in ${layout}`, async () => {
      const page = await fixture(options);
      try {
        await selectCaptureTheme(page, theme, expect);
        await expect(page.locator('main')).toHaveAttribute('data-theme', theme);
      } finally {
        await page.close();
      }
    });
  }
}

test('missing navigation/control fails closed', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<main data-theme="dark"></main>');
    await assert.rejects(selectCaptureTheme(page, 'dark', expect.configure({ timeout: 250 })));
  } finally {
    await page.close();
  }
});

test('a control that does not apply the requested theme fails closed', async () => {
  const page = await fixture({ categorized: true, hidden: true, broken: true });
  try {
    await assert.rejects(selectCaptureTheme(page, 'dark', expect.configure({ timeout: 250 })));
    await expect(page.locator('main')).toHaveAttribute('data-theme', 'system');
  } finally {
    await page.close();
  }
});

test('unsupported themes fail before interacting', async () => {
  await assert.rejects(selectCaptureTheme(null, 'system', expect), /Unsupported capture theme/);
});
