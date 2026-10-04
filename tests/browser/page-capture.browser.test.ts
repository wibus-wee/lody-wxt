import { beforeEach, expect, it, vi } from 'vitest';

import { capturePage } from '../../src/features/page-context/capture';

const api = vi.hoisted(() => ({
  query: vi.fn<() => Promise<{ id: number; url: string }[]>>(),
  contains: vi.fn<() => Promise<boolean>>(),
  request: vi.fn<(options: { origins: string[] }) => Promise<boolean>>(),
  executeScript: vi.fn<() => Promise<unknown[]>>(),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    tabs: { query: api.query },
    permissions: { contains: api.contains, request: api.request },
    scripting: { executeScript: api.executeScript },
  },
}));
vi.mock('../../src/shared/storage', () => ({ isExtension: () => true }));

const captured = {
  id: 'page',
  kind: 'page',
  title: 'Article',
  url: 'http://example.test/article',
  text: 'Page content',
  trust: 'untrusted',
};
beforeEach(() => {
  vi.resetAllMocks();
  api.query.mockResolvedValue([{ id: 42, url: 'http://example.test/article?private=value' }]);
  api.contains.mockResolvedValue(false);
});
it('uses a temporary tab grant without asking for persistent site access', async () => {
  api.executeScript
    .mockResolvedValueOnce([{ frameId: 0, result: true }])
    .mockResolvedValueOnce([{ frameId: 0, result: { ok: true, value: captured } }]);
  expect(await capturePage('page')).toEqual({ ...captured, tabId: 42, frameId: 0 });
  expect(api.request).not.toHaveBeenCalled();
});
it('requests only the active HTTP origin and preserves a declined grant as a failure', async () => {
  api.executeScript.mockRejectedValue(
    new Error(
      'Cannot access contents of url "http://example.test/article". Extension manifest must request permission to access this host.',
    ),
  );
  api.request.mockResolvedValue(false);
  await expect(capturePage('page')).rejects.toThrow('未获得此网站的访问权限');
  expect(api.request).toHaveBeenCalledWith({ origins: ['http://example.test/*'] });
  expect(api.executeScript).toHaveBeenCalledTimes(1);
});
it('reads the same tab after the user grants access to its origin', async () => {
  api.executeScript
    .mockRejectedValueOnce(new Error('Missing host permission for the tab'))
    .mockResolvedValueOnce([{ frameId: 0, result: { ok: true, value: captured } }]);
  api.request.mockResolvedValue(true);
  expect(await capturePage('page')).toEqual({ ...captured, tabId: 42, frameId: 0 });
  expect(api.executeScript).toHaveBeenLastCalledWith(
    expect.objectContaining({
      target: { tabId: 42, frameIds: [0] },
      args: ['page', expect.any(String), null],
    }),
  );
});
it('reports a closed tab instead of treating every injection failure as missing permission', async () => {
  api.executeScript.mockRejectedValue(new Error('No tab with id: 42'));
  await expect(capturePage('page')).rejects.toThrow('No tab with id: 42');
  expect(api.request).not.toHaveBeenCalled();
});
it('preserves extraction errors instead of parsing them as successful page data', async () => {
  api.contains.mockResolvedValue(true);
  api.executeScript.mockResolvedValue([
    { frameId: 0, result: { ok: false, error: '请先在网页中选中文字，再点击附加。' } },
  ]);
  await expect(capturePage('selection')).rejects.toThrow('请先在网页中选中文字');
  expect(api.request).not.toHaveBeenCalled();
});
