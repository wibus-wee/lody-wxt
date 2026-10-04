import * as v from 'valibot';
import { browser } from 'wxt/browser';

import { isExtension } from '../../shared/storage';
import { openSidePanel } from './actions';
import { capturePage, createLinkContext } from './capture';
import { pageContextSchema } from './model';

const whitespace = /\s+/g;
const storageKey = 'page-context:intents';
const intentSchema = v.object({
  id: v.string(),
  scope: v.string(),
  windowId: v.number(),
  expiresAt: v.number(),
  context: v.exactOptional(pageContextSchema),
  imageUrl: v.exactOptional(v.pipe(v.string(), v.url())),
  error: v.exactOptional(v.string()),
});
export type PageContextIntent = v.InferOutput<typeof intentSchema>;

async function accountScope(): Promise<string> {
  const stored = (await browser.storage.local.get('accountSession')).accountSession;
  if (!stored) return 'signed-out';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(stored)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function pendingPageIntents(): Promise<PageContextIntent[]> {
  if (!isExtension()) return [];
  const [scope, window, stored] = await Promise.all([
    accountScope(),
    browser.windows.getCurrent(),
    browser.storage.session.get(storageKey),
  ]);
  const parsed = v.safeParse(v.array(intentSchema), stored[storageKey] ?? []);
  return parsed.success
    ? parsed.output.filter(
        (intent) =>
          intent.scope === scope && intent.windowId === window.id && intent.expiresAt > Date.now(),
      )
    : [];
}

export async function dismissPageIntent(id: string): Promise<void> {
  const stored = (await browser.storage.session.get(storageKey))[storageKey];
  const parsed = v.safeParse(v.array(intentSchema), stored ?? []);
  await browser.storage.session.set({
    [storageKey]: parsed.success
      ? parsed.output.filter((intent) => intent.id !== id && intent.expiresAt > Date.now())
      : [],
  });
}

export function watchPageIntents(listener: () => void): () => void {
  if (!isExtension()) return () => {};
  const changed = (changes: Record<string, unknown>, area: string) => {
    if (
      (area === 'session' && Object.hasOwn(changes, storageKey)) ||
      (area === 'local' && Object.hasOwn(changes, 'accountSession'))
    )
      listener();
  };
  browser.storage.onChanged.addListener(changed);
  return () => browser.storage.onChanged.removeListener(changed);
}

export function registerPageContextEntrypoints() {
  const install = async () => {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: 'lody-ask',
      title: '询问 Lody',
      contexts: ['page', 'selection', 'link', 'image'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  };
  browser.runtime.onInstalled.addListener(() => {
    void install();
  });
  browser.commands.onCommand.addListener((command) => {
    if (command === 'open-lody')
      void openSidePanel().catch((error: unknown) => console.error(error));
  });
  let writes = Promise.resolve();
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== 'lody-ask' || tab?.id === undefined || tab.windowId === undefined)
      return;
    // Opening must stay in the context-menu gesture, before asynchronous capture.
    const opened = openSidePanel(tab.windowId);
    const tabId = tab.id;
    const windowId = tab.windowId;
    const scopePromise = accountScope();
    const capture = async () => {
      const scope = await scopePromise;
      let intent: PageContextIntent = {
        id: crypto.randomUUID(),
        scope,
        windowId,
        expiresAt: Date.now() + 10 * 60_000,
      };
      try {
        await opened;
        if (info.mediaType === 'image' && info.srcUrl) {
          const source = new URL(info.srcUrl);
          if (
            !new Set(['http:', 'https:']).has(source.protocol) ||
            source.username ||
            source.password
          )
            throw new Error('此图片不能通过链接附加，请保存图片后上传。');
          intent = { ...intent, imageUrl: source.href };
        } else if (info.linkUrl) {
          intent = { ...intent, context: createLinkContext(info.linkUrl, info.linkUrl) };
        } else {
          const context = await capturePage(info.selectionText ? 'selection' : 'page', {
            tabId,
            frameId: info.frameId ?? 0,
            expectedUrl: info.frameUrl ?? info.pageUrl ?? tab.url,
          });
          if (
            info.selectionText &&
            context.text !== info.selectionText.trim() &&
            !info.selectionText
              .replace(whitespace, ' ')
              .includes(context.text.replace(whitespace, ' '))
          )
            throw new Error('网页选区已变化，请重新选中文字后使用右键入口。');
          intent = { ...intent, context };
        }
      } catch (error) {
        intent = {
          ...intent,
          error: error instanceof Error ? error.message : '网页资料读取失败，请重试。',
        };
      }
      const parsed = v.safeParse(
        v.array(intentSchema),
        (await browser.storage.session.get(storageKey))[storageKey] ?? [],
      );
      const previous = parsed.success
        ? parsed.output
            .filter((entry) => entry.scope === scope && entry.expiresAt > Date.now())
            .slice(-9)
        : [];
      await browser.storage.session.set({ [storageKey]: [...previous, intent] });
    };
    writes = writes.then(capture, capture);
  });
}
