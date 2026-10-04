import * as v from 'valibot';
import { browser } from 'wxt/browser';

import { isExtension } from '../../shared/storage';
import type { CapturedPageContext, PageContext as AttachmentContext } from './model';
import { parseCapturedPageContext, parsePageContext } from './model';

async function activeCaptureTab() {
  if (!isExtension()) throw new Error('请在浏览器扩展中附加网页。');
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url)
    throw new Error('无法读取当前标签页，请点击工具栏上的 Lody 后重试。');
  const url = new URL(tab.url);
  if (!new Set(['http:', 'https:']).has(url.protocol))
    throw new Error('请打开普通网页后再附加，浏览器内部页面无法读取。');
  const origins = [`${url.origin}/*`];
  if (await browser.permissions.contains({ origins })) return tab.id;
  try {
    // activeTab grants can permit injection without appearing in permissions.contains.
    await browser.scripting.executeScript({ target: { tabId: tab.id }, func: () => true });
    return tab.id;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !['Cannot access contents of', 'Missing host permission'].some((reason) =>
        error.message.includes(reason),
      )
    )
      throw error;
  }
  const granted = await browser.permissions.request({ origins });
  if (!granted) throw new Error('未获得此网站的访问权限，没有附加任何内容。');
  return tab.id;
}

export async function capturePageContext(): Promise<CapturedPageContext> {
  const tabId = await activeCaptureTab();
  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: () => {
      const url = new URL(location.href);
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return {
        url: url.href,
        title: document.title.slice(0, 200),
        selection: window.getSelection()?.toString().slice(0, 32_000) ?? '',
      };
    },
  });
  return parseCapturedPageContext(results[0]?.result);
}

const captureResultSchema = v.variant('ok', [
  v.object({ ok: v.literal(true), value: v.unknown() }),
  v.object({ ok: v.literal(false), error: v.string() }),
]);

// Chrome serializes this function; keep extraction and error handling inside it.
function extractPage(kind: 'page' | 'selection', id: string) {
  try {
    // eslint-disable-next-line e18e/prefer-static-regex -- executeScript cannot access module scope.
    const whitespace = /\s+/g;
    const excluded =
      'input,textarea,select,button,form,script,style,noscript,nav,footer,header,aside,[hidden],[inert],[aria-hidden="true"],[contenteditable],[autocomplete],[data-sensitive]';
    const visible = (element: Element) => {
      if (element.closest(excluded)) return false;
      let current: Element | null = element;
      while (current) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0')
          return false;
        current = current.parentElement;
      }
      return element.getClientRects().length > 0;
    };
    const selection = window.getSelection();
    if (kind === 'selection' && (!selection || selection.isCollapsed))
      throw new Error('请先在网页中选中文字，再点击附加。');
    const range = kind === 'selection' ? selection?.getRangeAt(0) : undefined;
    const root =
      kind === 'page'
        ? ([
            ...document.querySelectorAll('main,[role="main"]'),
            ...document.querySelectorAll('article'),
          ].find(visible) ?? document.body)
        : document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const parts: string[] = [];
    let length = 0;
    let previousBlock: Element | undefined;
    while (walker.nextNode() && length < 12_000) {
      const node = walker.currentNode;
      if (node instanceof Element) {
        if (node.tagName === 'BR' && visible(node) && (!range || range.intersectsNode(node))) {
          parts.push('\n');
          length++;
        }
        continue;
      }
      if (!node.parentElement || !visible(node.parentElement)) continue;
      let text = node.textContent ?? '';
      if (range) {
        if (!range.intersectsNode(node)) continue;
        const start = range.startContainer === node ? range.startOffset : 0;
        const end = range.endContainer === node ? range.endOffset : text.length;
        text = text.slice(start, end);
      }
      text = text.replace(whitespace, ' ');
      if (!text) continue;
      if (text.trim()) {
        let block = node.parentElement;
        while (block !== root && block.parentElement) {
          const display = getComputedStyle(block).display;
          if (!display.startsWith('inline') && display !== 'contents') break;
          block = block.parentElement;
        }
        if (previousBlock && previousBlock !== block) {
          parts.push('\n');
          length++;
        }
        previousBlock = block;
      }
      parts.push(text.slice(0, 12_000 - length));
      length += text.length;
    }
    const text = parts
      .join('')
      .split('\n')
      .map((line) => line.replace(whitespace, ' ').trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 12_000);
    if (!text) throw new Error('没有找到可读取的正文，请尝试选中需要的文字后再附加。');
    const url = new URL(location.href);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return {
      ok: true,
      value: {
        id,
        kind,
        title: document.title.slice(0, 200),
        url: url.href,
        text,
        trust: 'untrusted',
      },
    };
  } catch (error) {
    // Script exceptions can arrive as an empty InjectionResult instead of a rejected promise.
    return {
      ok: false,
      error: error instanceof Error ? error.message : '网页读取失败，请刷新页面后重试。',
    };
  }
}

export async function capturePage(kind: 'page' | 'selection'): Promise<AttachmentContext> {
  const tabId = await activeCaptureTab();
  const [result] = await browser.scripting.executeScript({
    target: { tabId },
    func: extractPage,
    args: [kind, crypto.randomUUID()],
  });
  const parsed = v.parse(captureResultSchema, result?.result);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsePageContext(parsed.value);
}
