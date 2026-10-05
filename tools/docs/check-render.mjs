import assert from 'node:assert/strict';
import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const base = process.env.DOCS_URL ?? 'http://127.0.0.1:4000/';
const output = resolve('reports/docs');
const missingHeading = /找不到/;
const mdxSuffix = /\.mdx$/;
const indexSuffix = /\/index$/;
const root = resolve('docs/contents');
const files = [...globSync(`${root}/**/*.mdx`)];
const routes = new Set(
  files.map((file) =>
    `/docs/${file.slice(root.length + 1).replace(mdxSuffix, '')}`.replace(indexSuffix, ''),
  ),
);
const metadata = JSON.parse(readFileSync('docs/diagrams/metadata.json', 'utf8'));
const errors = [];
const observations = [];
const diagrams = new Set();
const fontRequests = new Set();
mkdirSync(output, { recursive: true });
async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('.woff2')) fontRequests.add(request.url());
  });

  async function assertLayout() {
    const measurements = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(measurements.scrollWidth <= measurements.width + 1, `Page overflows: ${page.url()}`);
  }

  try {
    for (const route of [...routes].sort()) {
      await page.goto(new URL(route, base).href);
      await page.locator('main h1').waitFor();
      assert.equal(await page.locator('#nd-docs-layout').count(), 1);
      assert.equal(await page.locator('#nd-page').count(), 1);
      assert.doesNotMatch(await page.locator('main h1').textContent(), missingHeading);
      assert.equal(await page.locator('article').count(), 1);
      const links = await page
        .locator('a')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
      for (const href of links) {
        if (href?.startsWith('/docs'))
          assert.ok(routes.has(new URL(href, base).pathname), `Broken route ${href} on ${route}`);
      }
      const bodyLinks = await page
        .locator('article a')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
      assert.ok(
        bodyLinks.every(
          (href) =>
            !href?.includes('github.com/wibus-wee/lody-wxt/blob/main/tutorial') &&
            !href?.endsWith('.mdx'),
        ),
        `Unresolved MDX link on ${route}`,
      );
      await assertLayout();

      const figures = page
        .locator('figure')
        .filter({ has: page.getByRole('link', { name: '下载 Excalidraw 源图' }) });
      for (let i = 0; i < (await figures.count()); i++) {
        const figure = figures.nth(i);
        await figure.scrollIntoViewIfNeeded();
        const canvas = figure.locator('canvas.excalidraw__canvas').first();
        await canvas.waitFor({ state: 'visible' });
        const download = figure.getByRole('link', { name: '下载 Excalidraw 源图' });
        const response = await context.request.get(
          new URL(await download.getAttribute('href'), base).href,
        );
        assert.ok(response.ok());
        const scene = await response.json();
        assert.equal(scene.type, 'excalidraw');
        assert.ok(scene.elements.length > 20);
        assert.ok(scene.elements.some((element) => element.type === 'arrow'));
        assert.ok(
          scene.elements
            .filter((element) => element.type === 'text')
            .every(
              (element) =>
                element.text.length <= 32 && element.fontFamily === 5 && element.fontSize <= 20,
            ),
          'Diagram labels must stay short and use the small handwritten type scale',
        );
        const id = (await download.getAttribute('download')).replace('.excalidraw', '');
        diagrams.add(id);
        for (const colorScheme of ['light', 'dark']) {
          await page.emulateMedia({ colorScheme });
          await figure
            .locator(
              colorScheme === 'dark' ? '.excalidraw.theme--dark' : '.excalidraw:not(.theme--dark)',
            )
            .waitFor();
          await page.waitForFunction(() =>
            ['Excalifont', 'Xiaolai'].every((family) =>
              [...document.fonts].some(
                (face) => face.family === family && face.status === 'loaded',
              ),
            ),
          );
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
          const pixels = await canvas.evaluate((node) => {
            const values = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
            const background = [...values.slice(0, 3)];
            let painted = 0;
            for (let j = 0; j < values.length; j += 16) {
              if (
                Math.abs(values[j] - background[0]) +
                  Math.abs(values[j + 1] - background[1]) +
                  Math.abs(values[j + 2] - background[2]) >
                50
              )
                painted++;
            }
            return painted;
          });
          assert.ok(pixels > 100, `Empty canvas: ${id}/${colorScheme}`);
          await figure.screenshot({ path: `${output}/${id}-${colorScheme}.png` });
        }
        await page.emulateMedia({ colorScheme: 'light' });
        await figure.locator('.excalidraw:not(.theme--dark)').waitFor();
        assert.equal(
          await figure
            .locator(
              '.App-menu_top:visible, .App-bottom-bar:visible, .App-toolbar-container:visible',
            )
            .count(),
          0,
        );
      }
      const axe = await new AxeBuilder({ page }).analyze();
      assert.equal(
        axe.violations.length,
        0,
        JSON.stringify({
          route,
          violations: axe.violations.map(({ id, nodes }) => ({ id, nodes })),
        }),
      );
      observations.push({
        route,
        figures: await figures.count(),
        axeViolations: axe.violations.length,
      });
    }
    assert.deepEqual([...diagrams].sort(), Object.keys(metadata).sort());

    for (const legacy of [
      'architecture',
      'design',
      'testing',
      'browser-assistant-spec',
      'browser-assistant-implementation',
    ]) {
      await page.goto(`${base}#/docs/${legacy}`);
      await page.waitForURL(`**/docs/dev/${legacy}`);
      await page.reload();
      await page.locator('main h1').waitFor();
    }
    await page.goto(base);
    await page.waitForURL('**/docs');
    await page.getByRole('link', { name: '发出第一条网页问题', exact: true }).last().click();
    await page.waitForURL('**/docs/tutorial/first-conversation');
    await page.getByRole('heading', { name: '发出第一条网页问题', exact: true }).waitFor();

    // Heading fragments must survive direct loading, refreshing and browser history.
    await page.goto(new URL('/docs/tutorial/first-conversation', base).href);
    const section = page.locator('article h2').nth(2);
    const sectionId = await section.getAttribute('id');
    await page.locator(`#nd-toc a[href="#${sectionId}"]`).click();
    await page.waitForURL((url) => decodeURIComponent(url.hash) === `#${sectionId}`);
    await page.reload();
    await section.waitFor();
    await page.waitForFunction((id) => {
      const top = document.getElementById(id)?.getBoundingClientRect().top;
      return top !== undefined && top >= 0 && top < 200;
    }, sectionId);
    const anchoredUrl = page.url();
    await page
      .locator('#nd-sidebar')
      .getByRole('link', { name: '安装与准备', exact: true })
      .click();
    await page.goBack();
    await page.waitForURL(anchoredUrl);

    // Search stays in the reader's audience and navigates using the standard dialog.
    await page.goto(new URL('/docs', base).href);
    await page.getByRole('heading', { name: 'Lody 浏览器助手', exact: true }).waitFor();
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: '搜索文档', exact: true }).fill('截图');
    const mediaResult = page.getByRole('option', {
      name: '产品文档 使用文件、截图、PDF 与字幕',
      exact: true,
    });
    await mediaResult.waitFor();
    assert.ok(
      (await page.getByRole('option').allTextContents()).every((text) =>
        text.startsWith('产品文档'),
      ),
    );
    let audit = await new AxeBuilder({ page }).analyze();
    assert.equal(
      audit.violations.length,
      0,
      JSON.stringify(audit.violations.map(({ id, nodes }) => ({ id, nodes }))),
    );
    await page.screenshot({ path: `${output}/search-product.png` });
    await mediaResult.click();
    await page.waitForURL('**/docs/guides/files-and-media');
    await page.getByRole('heading', { name: '使用文件、截图、PDF 与字幕', exact: true }).waitFor();
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: '搜索文档', exact: true }).fill('qxzvkjwnbnmtpr');
    await page.getByText('没有找到相关文档', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('combobox').waitFor({ state: 'hidden' });

    await page.goto(new URL('/docs/dev/architecture', base).href);
    await page.getByRole('heading', { name: 'Architecture', exact: true }).waitFor();
    assert.equal(
      await page
        .locator('#nd-sidebar')
        .getByRole('link', { name: '发出第一条网页问题', exact: true })
        .count(),
      0,
    );
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: '搜索文档', exact: true }).fill('session');
    await page.getByRole('option').first().waitFor();
    assert.ok(
      (await page.getByRole('option').allTextContents()).every((text) =>
        text.startsWith('开发资料'),
      ),
    );
    await page.keyboard.press('Escape');
    await page.getByRole('combobox').waitFor({ state: 'hidden' });

    // Verify the standard MDX code block copies its real contents.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(new URL('/docs/dev/getting-started', base).href);
    const code = page.locator('main pre').first();
    await code.waitFor();
    const expectedCode = (await code.textContent()).trim();
    await page.getByRole('button', { name: '复制代码', exact: true }).first().click();
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).trim(), expectedCode);

    // An explicit theme selection must update diagrams and persist across a refresh.
    await page.goto(new URL('/docs/guides/page-questions', base).href);
    await page.getByRole('button', { name: '深色主题', exact: true }).click();
    await page.locator('.excalidraw.theme--dark').waitFor();
    await page.reload();
    await page.locator('.excalidraw.theme--dark').waitFor();
    assert.equal(await page.locator('html').getAttribute('class'), 'dark');
    audit = await new AxeBuilder({ page }).analyze();
    assert.equal(
      audit.violations.length,
      0,
      JSON.stringify(audit.violations.map(({ id, nodes }) => ({ id, nodes }))),
    );
    await page.screenshot({ path: `${output}/desktop-dark.png` });
    await page.getByRole('button', { name: '浅色主题', exact: true }).click();
    await page.locator('.excalidraw:not(.theme--dark)').waitFor();
    await page.screenshot({ path: `${output}/desktop-light.png` });
    await page.getByRole('button', { name: '跟随系统', exact: true }).click();
    observations.push({
      fumadocs: true,
      headingLinks: true,
      scopedSearch: true,
      emptySearch: true,
      copyCode: true,
      themePersistence: true,
    });

    for (const width of [320, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(new URL('/docs/guides/page-questions', base).href);
      await page.getByRole('button', { name: '打开文档目录', exact: true }).click();
      await page
        .locator('#nd-sidebar-mobile')
        .getByRole('link', { name: '发出第一条网页问题', exact: true })
        .click();
      await page.waitForURL('**/docs/tutorial/first-conversation');
      await page.getByRole('heading', { name: '发出第一条网页问题', exact: true }).waitFor();
      await page.locator('#nd-sidebar-mobile[data-state=closed]').waitFor({ state: 'hidden' });
      await assertLayout();
      const figure = page
        .locator('figure')
        .filter({ has: page.getByRole('link', { name: '下载 Excalidraw 源图' }) })
        .first();
      await figure.scrollIntoViewIfNeeded();
      await figure.locator('canvas.excalidraw__canvas').first().waitFor({ state: 'visible' });
      const region = figure.getByRole('region');
      await region.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.activeElement.scrollLeft > 0);
      await page.screenshot({ path: `${output}/mobile-${width}.png`, fullPage: true });
      const axe = await new AxeBuilder({ page }).analyze();
      assert.equal(axe.violations.length, 0, JSON.stringify(axe.violations.map(({ id }) => id)));
      observations.push({ width, keyboardScroll: true, axeViolations: axe.violations.length });
    }
    await page.goto(new URL('/docs/does-not-exist', base).href);
    await page.getByRole('heading', { name: '找不到这篇文档' }).waitFor();
    assert.deepEqual(errors, []);
    assert.ok(fontRequests.size > 1);
    assert.ok(
      [...fontRequests].every(
        (url) =>
          new URL(url).origin === new URL(base).origin &&
          new URL(url).pathname.includes('/excalidraw/fonts/'),
      ),
      'Diagram fonts must load locally without a CDN fallback',
    );
    const report = {
      base,
      pages: routes.size,
      diagrams: [...diagrams],
      reducedMotion: true,
      fonts: { families: ['Excalifont', 'Xiaolai'], localRequests: fontRequests.size },
      observations,
      errors,
    };
    writeFileSync(`${output}/render.json`, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(
      `Verified ${routes.size} documentation pages, ${diagrams.size} Excalidraw diagrams in both themes, Fumadocs navigation, scoped Chinese search, heading links, copy buttons, theme persistence, legacy links and mobile keyboard scrolling. Axe: zero violations.\n`,
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
