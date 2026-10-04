import { expect, it, vi } from 'vitest';

import { requestApiAccess } from '../../src/features/page-context/actions';
import { parseCapturedPageContext, parsePageContext } from '../../src/features/page-context/model';

it('requests host access during the click before yielding to account configuration', async () => {
  let finishRequest!: (granted: boolean) => void;
  const request = vi.fn(() => new Promise<boolean>((resolve) => (finishRequest = resolve)));
  const configure = vi.fn();
  const button = document.createElement('button');
  let pending: Promise<void> | undefined;
  button.addEventListener('click', () => {
    pending = requestApiAccess('https://auth.example.test/', {
      protocol: 'chrome-extension:',
      request,
    }).then(configure);
    expect(request).toHaveBeenCalledOnce();
  });
  button.click();
  expect(request).toHaveBeenCalledWith({ origins: ['https://auth.example.test/*'] });
  expect(configure).not.toHaveBeenCalled();
  finishRequest(true);
  await pending;
  expect(configure).toHaveBeenCalledOnce();
});

it('normalizes a configured host and port without expanding the grant to other hosts', async () => {
  const request = vi.fn(async () => true);
  await requestApiAccess('https://AUTH.example.test:8443/', {
    protocol: 'chrome-extension:',
    request,
  });
  expect(request).toHaveBeenCalledWith({ origins: ['https://auth.example.test:8443/*'] });
});

it('uses ordinary web transport without requesting extension privileges on web pages', async () => {
  const request = vi.fn(async () => true);
  for (const protocol of ['https:', 'http:']) {
    await requestApiAccess('https://auth.example.test', { protocol, request });
  }
  await requestApiAccess('https://auth.example.test');
  expect(request).not.toHaveBeenCalled();
});

it('exposes declined access to the account error boundary and prevents configuration', async () => {
  const configure = vi.fn();
  const request = vi.fn(async () => false);
  await expect(
    requestApiAccess('https://auth.example.test', {
      protocol: 'chrome-extension:',
      request,
    }).then(configure),
  ).rejects.toMatchObject({ code: 'browser_access_declined' });
  expect(configure).not.toHaveBeenCalled();
});

it('rejects invalid origins before requesting any browser privileges', async () => {
  const request = vi.fn(async () => true);
  for (const origin of [
    'not a URL',
    'http://auth.example.test',
    'https://auth.example.test/path',
    'https://auth.example.test?token=secret',
    'https://auth.example.test#fragment',
    'https://user:secret@auth.example.test',
    'https://auth.example.test/../',
  ]) {
    await expect(
      requestApiAccess(origin, { protocol: 'chrome-extension:', request }),
    ).rejects.toMatchObject({ code: 'invalid_configuration' });
  }
  expect(request).not.toHaveBeenCalled();
});

it('preserves browser API failures for the caller', async () => {
  const failure = new Error('Permission requests require a user gesture.');
  await expect(
    requestApiAccess('https://auth.example.test', {
      protocol: 'chrome-extension:',
      request: () => Promise.reject(failure),
    }),
  ).rejects.toBe(failure);
});

it('rejects malformed attachment payloads instead of substituting page data', () => {
  const context = {
    id: 'capture-1',
    kind: 'selection',
    title: 'Source',
    url: 'https://example.test/article',
    text: 'Selected text',
    trust: 'untrusted',
  };
  expect(parsePageContext(context)).toEqual(context);
  for (const invalid of [
    { ...context, kind: 'clip' },
    { ...context, trust: 'trusted' },
    { ...context, text: '' },
    { ...context, text: 'x'.repeat(32_001) },
    { ...context, url: 'javascript:alert(1)' },
    { ...context, url: 'https://user:secret@example.test/' },
    { ...context, capturedAt: 123 },
    { ...context, content: context.text },
  ]) {
    expect(() => parsePageContext(invalid)).toThrow();
  }
});

it('keeps selection capture separate and permits an empty selection for new sessions', () => {
  const context = { url: 'https://example.test/', title: 'Source', selection: '' };
  expect(parseCapturedPageContext(context)).toEqual(context);
  expect(() => parseCapturedPageContext({ ...context, selection: 42 })).toThrow();
  expect(() => parseCapturedPageContext({ ...context, text: 'fallback' })).toThrow();
});

it('keeps approved source locators while removing credentials and unrelated query parameters', async () => {
  const { createLinkContext, publicSourceUrl } =
    await import('../../src/features/page-context/capture');
  expect(publicSourceUrl('https://www.youtube.com/watch?v=abc_123&t=90&token=secret#private')).toBe(
    'https://www.youtube.com/watch?v=abc_123&t=90',
  );
  expect(
    publicSourceUrl('https://github.com/owner/repo/blob/main/code.ts?access_token=secret#L12-L18'),
  ).toBe('https://github.com/owner/repo/blob/main/code.ts#L12-L18');
  expect(publicSourceUrl('https://example.test/report.pdf?key=secret#page=12')).toBe(
    'https://example.test/report.pdf#page=12',
  );
  const link = 'https://example.test/report?token=secret';
  expect(createLinkContext(link, link)).toMatchObject({
    title: 'https://example.test/report',
    text: 'https://example.test/report',
    kind: 'link',
  });
  expect(() => publicSourceUrl('https://user:password@example.test/')).toThrow('登录凭证');
});
