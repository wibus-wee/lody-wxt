import * as v from 'valibot';
import { browser } from 'wxt/browser';

import { isExtension } from '../../shared/storage';
import type { CapturedPageContext, PageContext as AttachmentContext } from './model';
import { parseCapturedPageContext, parsePageContext } from './model';

export interface CaptureTarget {
  tabId: number;
  frameId?: number;
  expectedUrl?: string | undefined;
}

export async function authorizedCaptureTab(target?: CaptureTarget) {
  if (!isExtension()) throw new Error('请在浏览器扩展中附加网页。');
  const tab = target
    ? await browser.tabs.get(target.tabId)
    : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (target?.expectedUrl && !target.frameId && tab?.url !== target.expectedUrl)
    throw new Error('来源页面已导航，请重新选择后附加。');
  if (tab?.id === undefined || !tab.url)
    throw new Error('无法读取当前标签页，请点击工具栏上的 Lody 后重试。');
  const url = new URL(target?.frameId && target.expectedUrl ? target.expectedUrl : tab.url);
  if (!new Set(['http:', 'https:']).has(url.protocol))
    throw new Error('请打开普通网页后再附加，浏览器内部页面无法读取。');
  const origins = [`${url.origin}/*`];
  if (await browser.permissions.contains({ origins })) return tab.id;
  try {
    // activeTab grants can permit injection without appearing in permissions.contains.
    await browser.scripting.executeScript({
      target: { tabId: tab.id, ...(target?.frameId ? { frameIds: [target.frameId] } : {}) },
      func: () => true,
    });
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
  const tabId = await authorizedCaptureTab();
  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: () => {
      const url = new URL(location.href);
      url.username = '';
      url.password = '';
      const selected = window.getSelection();
      const range = selected?.rangeCount ? selected.getRangeAt(0) : undefined;
      const excluded =
        'input,textarea,select,form,[hidden],[inert],[aria-hidden="true"],[contenteditable],[autocomplete],[data-sensitive]';
      const sensitive =
        range &&
        [...document.querySelectorAll(excluded)].some((element) => range.intersectsNode(element));
      return {
        url: url.href,
        title: document.title.slice(0, 200),
        selection: sensitive ? '' : (selected?.toString().slice(0, 32_000) ?? ''),
      };
    },
  });
  const captured = v.parse(
    v.object({ url: v.string(), title: v.string(), selection: v.string() }),
    results[0]?.result,
  );
  return parseCapturedPageContext({ ...captured, url: publicSourceUrl(captured.url) });
}

const captureResultSchema = v.variant('ok', [
  v.object({ ok: v.literal(true), value: v.unknown() }),
  v.object({ ok: v.literal(false), error: v.string() }),
]);

// Chrome serializes this function; keep extraction and error handling inside it.
function extractPage(kind: 'page' | 'selection', id: string, expectedUrl?: string | null) {
  try {
    if (expectedUrl && location.href !== expectedUrl)
      throw new Error('来源页面已导航，请重新选择后附加。');
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
    const parts: string[] = [];
    const roots: Array<{ root: Node; label: string }> = [{ root, label: '' }];
    let inaccessibleFrames = 0;
    for (const source of roots) {
      if (source.label) parts.push(`\n[${source.label}]\n`);
      const walker = document.createTreeWalker(
        source.root,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      );
      let previousBlock: Element | undefined;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (!range && visible(element)) {
            if (element.shadowRoot)
              roots.push({ root: element.shadowRoot, label: '开放 Shadow DOM' });
            if (element.tagName === 'IFRAME') {
              try {
                const frame = element as HTMLIFrameElement;
                const content = frame.contentDocument;
                if (content?.body)
                  roots.push({
                    root: content.body,
                    label: `嵌入页面：${new Set(['about:srcdoc', 'about:blank']).has(content.URL) ? location.origin : new URL(content.URL).origin}`,
                  });
                else inaccessibleFrames++;
              } catch {
                inaccessibleFrames++;
              }
            }
          }
          if (
            element.tagName === 'BR' &&
            visible(element) &&
            (!range || range.intersectsNode(node))
          ) {
            parts.push('\n');
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
          while (block !== source.root && block.parentElement) {
            const display = getComputedStyle(block).display;
            if (!display.startsWith('inline') && display !== 'contents') break;
            block = block.parentElement;
          }
          if (previousBlock && previousBlock !== block) {
            parts.push('\n');
          }
          previousBlock = block;
        }
        parts.push(text);
      }
    }
    if (inaccessibleFrames)
      parts.push(`\n[覆盖范围：${inaccessibleFrames} 个跨来源或不可访问的嵌入页面未读取]`);
    const text = parts
      .join('')
      .split('\n')
      .map((line) => line.replace(whitespace, ' ').trim())
      .filter(Boolean)
      .join('\n');
    if (!text) throw new Error('没有找到可读取的正文，请尝试选中需要的文字后再附加。');
    const url = new URL(location.href);
    url.username = '';
    url.password = '';
    return {
      ok: true,
      value: {
        id,
        kind,
        title: document.title.slice(0, 200),
        url: url.href,
        text: text.slice(0, 12_000),
        capturedAt: new Date().toISOString(),
        truncated: text.length > 12_000,
        sourceLength: text.length,
        sourceRevision: `${performance.timeOrigin}:${text.length}:${Array.from(text).reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619), 2166136261) >>> 0}`,
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

export async function capturePage(
  kind: 'page' | 'selection',
  target?: CaptureTarget,
): Promise<AttachmentContext> {
  const tabId = await authorizedCaptureTab(target);
  const [result] = await browser.scripting.executeScript({
    target: { tabId, frameIds: [target?.frameId ?? 0] },
    func: extractPage,
    args: [kind, crypto.randomUUID(), target?.expectedUrl ?? null],
  });
  const parsed = v.parse(captureResultSchema, result?.result);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsePageContext({
    ...normalizeCapturedContext(parsed.value),
    tabId,
    frameId: target?.frameId ?? 0,
    ...(result?.documentId ? { documentId: result.documentId } : {}),
  });
}

const httpUrl = /^https?:/;

export interface ContextTab {
  id: number;
  title: string;
  url: string;
  groupId: number;
}

export async function listContextTabs(): Promise<ContextTab[]> {
  if (!isExtension()) throw new Error('请在浏览器扩展中选择标签页。');
  const tabs = await browser.tabs.query({ currentWindow: true });
  return tabs.flatMap((tab) =>
    tab.id !== undefined && tab.url && httpUrl.test(tab.url)
      ? [{ id: tab.id, title: tab.title ?? tab.url, url: tab.url, groupId: tab.groupId }]
      : [],
  );
}

export type ContextFreshness = 'current' | 'changed' | 'closed' | 'unknown';

export async function readContextFreshness(context: AttachmentContext): Promise<ContextFreshness> {
  if (!isExtension() || context.tabId === undefined || context.kind === 'link') return 'unknown';
  try {
    const tab = await browser.tabs.get(context.tabId);
    if (!tab.url || publicSourceUrl(tab.url) !== context.url) return 'changed';
    const [result] = await browser.scripting.executeScript({
      target: { tabId: context.tabId, frameIds: [context.frameId ?? 0] },
      func: extractPage,
      args: [context.kind, context.id],
    });
    if (context.documentId && result?.documentId !== context.documentId) return 'changed';
    const parsed = v.safeParse(captureResultSchema, result?.result);
    if (!parsed.success || !parsed.output.ok) return 'unknown';
    const latest = normalizeCapturedContext(parsed.output.value);
    return context.sourceRevision && context.sourceRevision !== latest.sourceRevision
      ? 'changed'
      : 'current';
  } catch {
    try {
      await browser.tabs.get(context.tabId);
      return 'unknown';
    } catch {
      return 'closed';
    }
  }
}

const youtubeId = /^[\w-]{1,64}$/;
const videoTime = /^[0-9hms]{1,20}$/;
const pdfPage = /^#page=[1-9]\d{0,5}$/;
const githubLine = /^#L[1-9]\d{0,6}(?:-L[1-9]\d{0,6})?$/;
const docsHeading = /^#heading=h\.[\w-]{1,80}$/;
const pdfSuffix = /\.pdf$/i;

export function publicSourceUrl(value: string): string {
  const url = new URL(value);
  if (!new Set(['http:', 'https:']).has(url.protocol) || url.username || url.password)
    throw new Error('仅支持不含登录凭证的 HTTP 或 HTTPS 链接。');
  const params = new URLSearchParams();
  if (new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']).has(url.hostname)) {
    const id = url.searchParams.get('v');
    const time = url.searchParams.get('t');
    if (id && youtubeId.test(id)) params.set('v', id);
    if (time && videoTime.test(time)) params.set('t', time);
  }
  const fragment =
    (pdfSuffix.test(url.pathname) && pdfPage.test(url.hash)) ||
    (url.hostname === 'github.com' && githubLine.test(url.hash)) ||
    (url.hostname === 'docs.google.com' && docsHeading.test(url.hash))
      ? url.hash
      : '';
  url.search = params.toString();
  url.hash = fragment;
  return url.href;
}

function normalizeCapturedContext(value: unknown): AttachmentContext {
  const context = v.parse(v.looseObject({ url: v.string() }), value);
  return parsePageContext({ ...context, url: publicSourceUrl(context.url) });
}

export function createLinkContext(value: string, title?: string): AttachmentContext {
  const url = publicSourceUrl(value.trim());
  return parsePageContext({
    id: crypto.randomUUID(),
    kind: 'link',
    title: (title?.trim() === value.trim() ? url : title?.trim() || url).slice(0, 200),
    url,
    text: url,
    trust: 'untrusted',
    capturedAt: new Date().toISOString(),
  });
}
