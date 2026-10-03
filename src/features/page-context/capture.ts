import { browser } from 'wxt/browser';

import { isExtension } from '../../shared/storage';
import type { PageContext } from './model';

// Executed only after an explicit attachment gesture; it must be self-contained for MV3.
export function extractPage(kind: 'page' | 'selection'): Omit<PageContext, 'id'> {
  // The extractor is serialized by scripting.executeScript and has no module scope.
  // eslint-disable-next-line e18e/prefer-static-regex
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
    throw new Error('没有选中文字。请先在页面正文中选择文字。');
  const root =
    kind === 'page'
      ? (document.querySelector('article,main,[role="main"]') ?? document.body)
      : document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let length = 0;
  while (walker.nextNode() && length < 12000) {
    const node = walker.currentNode;
    if (!node.parentElement || !visible(node.parentElement)) continue;
    let text = node.textContent ?? '';
    if (kind === 'selection') {
      if (!selection?.containsNode(node, true)) continue;
      const range = selection.getRangeAt(0);
      const start = range.startContainer === node ? range.startOffset : 0;
      const end = range.endContainer === node ? range.endOffset : text.length;
      text = text.slice(start, end);
    }
    text = text.replace(whitespace, ' ').trim();
    if (text) {
      parts.push(text);
      length += text.length + 1;
    }
  }
  const text = parts.join('\n').slice(0, 12000);
  if (!text)
    throw new Error(
      kind === 'selection'
        ? '没有可读取的选中文字；表单及隐藏内容不会附加。'
        : '页面没有可读取的正文。',
    );
  const url = new URL(location.href);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return { kind, title: document.title.slice(0, 200), url: url.href, text, trust: 'untrusted' };
}

const webUrl = /^https?:\/\//;
const readableError = /选中文字|正文/;
export async function capturePage(kind: 'page' | 'selection'): Promise<PageContext> {
  if (!isExtension()) {
    throw new Error('网页预览无法读取其他标签页。请在打包扩展侧栏附加，或使用“附加演示页面”。');
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !webUrl.test(tab.url))
    throw new Error('此页面不可访问。请打开普通 HTTP / HTTPS 网页。');
  const origin = `${new URL(tab.url).origin}/*`;
  // Side-panel gestures do not inherit an action's activeTab grant. Request only this origin.
  const granted =
    (await browser.permissions.contains({ origins: [origin] })) ||
    (await browser.permissions.request({ origins: [origin] }));
  if (!granted) throw new Error('页面权限被拒绝。未读取网页；可再次附加并授权当前网站。');
  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPage,
      args: [kind],
    });
    if (!result?.result) throw new Error('没有可读取的选中文字或正文。');
    return { ...result.result, id: crypto.randomUUID() };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (readableError.test(message)) throw error;
    throw new Error('无法读取页面。检查网站权限；Chrome 内置页和 Chrome 商店不允许注入。');
  }
}

export function demoPage(): PageContext {
  return {
    id: crypto.randomUUID(),
    kind: 'page',
    title: 'Lody · 浏览器工作区（演示页面）',
    url: 'https://github.com/LodyAI/lody',
    text: 'Lody 将工作区、机器与 Agent 会话连接起来。网页资料由用户主动附加，不授予任何工具权限。',
    trust: 'untrusted',
  };
}
