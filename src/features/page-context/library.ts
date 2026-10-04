import type { Browser } from 'wxt/browser';
import { browser } from 'wxt/browser';

import { createLinkContext } from './capture';
import type { PageContext } from './model';

export interface LibraryEntry {
  id: string;
  title: string;
  url: string;
}
export type LibraryKind = 'history' | 'bookmarks';

async function permission(kind: LibraryKind): Promise<void> {
  const permissions = [kind];
  if (
    !(await browser.permissions.contains({ permissions })) &&
    !(await browser.permissions.request({ permissions }))
  )
    throw new Error(kind === 'history' ? '未获得浏览历史权限。' : '未获得书签权限。');
}

export async function searchLibrary(
  kind: LibraryKind,
  query: string,
  days = 1,
  domain = '',
): Promise<LibraryEntry[]> {
  if (!query.trim()) throw new Error('请输入要查找的标题或网址。');
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new Error('历史查询范围应在 1 到 30 天内。');
  const host = domain.trim().toLowerCase();
  if (host && (host.includes('/') || host.includes(':') || host.includes(' ')))
    throw new Error('域名无需包含协议或路径。');
  await permission(kind);
  const rows =
    kind === 'history'
      ? await browser.history.search({
          text: query.trim(),
          startTime: Date.now() - days * 86_400_000,
          maxResults: 50,
        })
      : await browser.bookmarks.search(query.trim());
  return rows
    .flatMap((row) => {
      if (!row.url) return [];
      try {
        const url = new URL(row.url);
        if (!new Set(['http:', 'https:']).has(url.protocol) || (host && url.hostname !== host))
          return [];
        return [{ id: row.id, title: row.title || url.hostname, url: row.url }];
      } catch {
        return [];
      }
    })
    .slice(0, 50);
}

export function libraryContext(entry: LibraryEntry): PageContext {
  return createLinkContext(entry.url, entry.title);
}

export async function addBookmark(title: string, value: string): Promise<LibraryEntry> {
  const url = new URL(value);
  if (!new Set(['http:', 'https:']).has(url.protocol) || url.username || url.password)
    throw new Error('请输入不含登录凭证的网页地址。');
  if (!title.trim()) throw new Error('请输入书签名称。');
  await permission('bookmarks');
  const result = await browser.bookmarks.create({ title: title.trim(), url: url.href });
  if (!result.url) throw new Error('浏览器未返回已创建书签的地址。');
  return { id: result.id, title: result.title, url: result.url };
}

export async function deleteBookmark(entry: LibraryEntry): Promise<void> {
  await permission('bookmarks');
  const [current] = await browser.bookmarks.get(entry.id);
  if (current?.url !== entry.url || current.title !== entry.title)
    throw new Error('书签已变化，请重新搜索后确认。');
  await browser.bookmarks.remove(entry.id);
}

export async function revokeLibraryAccess(kind: LibraryKind): Promise<void> {
  await browser.permissions.remove({ permissions: [kind] });
}

export async function listBookmarkFolders(): Promise<Array<{ id: string; title: string }>> {
  await permission('bookmarks');
  const folders: Array<{ id: string; title: string }> = [];
  const visit = (nodes: Browser.bookmarks.BookmarkTreeNode[], prefix: string) => {
    for (const node of nodes) {
      if (node.url) continue;
      const title = [prefix, node.title].filter(Boolean).join(' / ');
      if (node.id !== '0') folders.push({ id: node.id, title });
      if (node.children) visit(node.children, title);
    }
  };
  visit(await browser.bookmarks.getTree(), '');
  return folders;
}

export async function moveBookmark(entry: LibraryEntry, parentId: string): Promise<void> {
  await permission('bookmarks');
  const [current] = await browser.bookmarks.get(entry.id);
  if (current?.url !== entry.url || current.title !== entry.title)
    throw new Error('书签已变化，请重新搜索后确认。');
  const [folder] = await browser.bookmarks.get(parentId);
  if (!folder || folder.url || folder.id === '0') throw new Error('所选书签文件夹已不可用。');
  const result = await browser.bookmarks.move(entry.id, { parentId });
  if (result.parentId !== parentId)
    throw new Error('浏览器未确认书签的目标文件夹，请在浏览器书签中核对结果。');
}
