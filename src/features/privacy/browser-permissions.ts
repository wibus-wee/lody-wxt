import * as v from 'valibot';
import { browser } from 'wxt/browser';

export interface BrowserAccess {
  origins: Array<{ pattern: string; required: boolean }>;
  permissions: Array<{ name: string; required: boolean }>;
}
export interface BrowserPermissionPort {
  available: boolean;
  getAll: () => Promise<{ origins?: string[]; permissions?: string[] }>;
  required: () => { host_permissions?: string[]; permissions?: string[] };
  remove: (input: { origins?: string[]; permissions?: string[] }) => Promise<boolean>;
  openShortcuts: () => Promise<void>;
}
function realPort(): BrowserPermissionPort {
  return {
    available: new Set(['chrome-extension:', 'moz-extension:']).has(location.protocol),
    getAll: () => browser.permissions.getAll(),
    required: () => {
      const manifest = browser.runtime.getManifest();
      return {
        host_permissions: manifest.host_permissions ?? [],
        permissions: manifest.permissions ?? [],
      };
    },
    remove: (input) =>
      browser.permissions.remove({
        ...(input.origins ? { origins: input.origins } : {}),
        ...(input.permissions
          ? {
              permissions: input.permissions.map((name) =>
                v.parse(
                  v.picklist([
                    'history',
                    'bookmarks',
                    'notifications',
                    'downloads',
                    'debugger',
                    'tabGroups',
                    'clipboardRead',
                    'clipboardWrite',
                  ]),
                  name,
                ),
              ),
            }
          : {}),
      }),
    openShortcuts: async () => {
      await browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
    },
  };
}
export async function readBrowserAccess(
  port: BrowserPermissionPort = realPort(),
): Promise<BrowserAccess | null> {
  if (!port.available) return null;
  const granted = await port.getAll();
  const required = port.required();
  return {
    origins: (granted.origins ?? []).map((pattern) => ({
      pattern,
      required: required.host_permissions?.includes(pattern) ?? false,
    })),
    permissions: (granted.permissions ?? []).map((name) => ({
      name,
      required: required.permissions?.includes(name) ?? false,
    })),
  };
}
export async function revokeBrowserAccess(
  kind: 'origin' | 'permission',
  value: string,
  port: BrowserPermissionPort = realPort(),
) {
  const current = await readBrowserAccess(port);
  if (!current) throw new Error('请在扩展中管理浏览器权限。');
  const entry =
    kind === 'origin'
      ? current.origins.find((row) => row.pattern === value)
      : current.permissions.find((row) => row.name === value);
  if (!entry) return;
  if (entry.required) throw new Error('此权限是扩展运行所必需的，请通过浏览器管理扩展。');
  const removed = await port.remove(
    kind === 'origin' ? { origins: [value] } : { permissions: [value] },
  );
  if (!removed) throw new Error('浏览器未撤销该权限，请重试。');
  const after = await port.getAll();
  if ((kind === 'origin' ? after.origins : after.permissions)?.includes(value))
    throw new Error('该权限仍然有效，请在浏览器扩展设置中检查。');
}
export async function openShortcutSettings(port: BrowserPermissionPort = realPort()) {
  if (!port.available) throw new Error('请在 Chrome 扩展中打开快捷键设置。');
  await port.openShortcuts();
}
