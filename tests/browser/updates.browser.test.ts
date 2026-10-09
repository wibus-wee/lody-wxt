import * as v from 'valibot';
import { expect, it } from 'vitest';

import {
  appcastSchema,
  availableRelease,
  compareVersions,
  emptyUpdateState,
  feedUrl,
  fetchAppcast,
} from '../../src/features/updates/appcast';
import config from '../../src/features/updates/config.json';

const feed = {
  schemaVersion: config.schemaVersion,
  application: config.application,
  channel: config.channel,
  version: '0.2.0',
  releaseNotesUrl: `${config.repository}/releases/tag/v0.2.0`,
  installationUrl: `${config.repository}/releases/download/v0.2.0/INSTALL.md`,
  enclosure: {
    url: `${config.repository}/releases/download/v0.2.0/lody-chrome.zip`,
    length: 4_000_000,
    sha256: 'a'.repeat(64),
    type: 'application/zip' as const,
  },
};
function response(body: string, status = 200, url = feedUrl) {
  const reply = new Response(body, { status });
  Object.defineProperty(reply, 'url', { value: url });
  return reply;
}

it('compares numeric Chrome versions and never offers a downgrade', () => {
  expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
  expect(compareVersions('1.0.0', '1.0.0.0')).toBe(0);
  expect(compareVersions('1.0.0.1', '1.0.0')).toBe(1);
  expect(compareVersions('0.2.0', '1.0.0')).toBe(-1);
  const state = { ...emptyUpdateState, release: feed };
  expect(availableRelease(state, '0.1.0')?.version).toBe('0.2.0');
  expect(availableRelease(state, '0.3.0')).toBeNull();
  for (const version of ['01.0.0', '1.0.0-beta', '1.0.0\n', '65536.0.0', 'NaN.0.0'])
    expect(() => compareVersions(version, '0.1.0')).toThrow();
});

it('only accepts bounded stable releases with version-pinned official assets', () => {
  expect(v.parse(appcastSchema, feed)).toEqual(feed);
  for (const enclosure of [
    { ...feed.enclosure, url: `${config.repository}/releases/latest/download/lody-chrome.zip` },
    { ...feed.enclosure, url: 'https://untrusted.test/lody.zip' },
    { ...feed.enclosure, url: `${feed.enclosure.url}?redirect=evil` },
    { ...feed.enclosure, length: 0 },
    { ...feed.enclosure, length: 1.5 },
    { ...feed.enclosure, sha256: 'invalid' },
  ])
    expect(v.safeParse(appcastSchema, { ...feed, enclosure }).success).toBe(false);
  for (const changed of [
    { ...feed, channel: 'beta' },
    { ...feed, schemaVersion: 2 },
    { ...feed, version: '0.2.0-beta' },
    { ...feed, installationUrl: 'javascript:alert(1)' },
  ])
    expect(v.safeParse(appcastSchema, changed).success).toBe(false);
});

it('requests only the public feed with no credentials or account headers', async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const actual = await fetchAppcast(async (url, init) => {
    calls.push({ url: String(url), init });
    return response(JSON.stringify(feed));
  });
  expect(actual).toEqual(feed);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe(feedUrl);
  expect(calls[0]?.init).toMatchObject({
    credentials: 'omit',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
});

it('keeps HTTP, invalid JSON, untrusted redirects and oversized feeds visible as failures', async () => {
  const request = (reply: Response) => fetchAppcast(async () => reply);
  await expect(request(response('offline', 503))).rejects.toThrow('HTTP 503');
  await expect(request(response('{broken'))).rejects.toThrow('JSON');
  await expect(request(response(JSON.stringify({ ...feed, version: '9.0.0' })))).rejects.toThrow(
    '格式无效',
  );
  await expect(
    request(response(JSON.stringify(feed), 200, 'https://untrusted.test/appcast.json')),
  ).rejects.toThrow('未允许');
  await expect(request(response('a'.repeat(64 * 1024 + 1)))).rejects.toThrow('64 KiB');
});
