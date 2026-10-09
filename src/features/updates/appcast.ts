import * as v from 'valibot';

import config from './config.json' with { type: 'json' };

const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/;
const sha256Pattern = /^[a-f\d]{64}$/;
const versionSchema = v.pipe(
  v.string(),
  v.regex(versionPattern),
  v.check(
    (value) => value.trim() === value && value.split('.').every((part) => Number(part) <= 65535),
  ),
);
const stableVersionSchema = v.pipe(
  versionSchema,
  v.check((value) => value.split('.').length === 3 && value !== '0.0.0'),
);
export const updateKey = 'releaseUpdate';
export const updateAlarm = 'lody:release-update';
export const checkIntervalMs = 6 * 60 * 60 * 1000;
export const feedUrl = config.feedUrl;
export const appcastSchema = v.pipe(
  v.strictObject({
    schemaVersion: v.literal(config.schemaVersion),
    application: v.literal(config.application),
    channel: v.literal(config.channel),
    version: stableVersionSchema,
    releaseNotesUrl: v.string(),
    installationUrl: v.string(),
    enclosure: v.strictObject({
      url: v.string(),
      length: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(256 * 1024 * 1024)),
      sha256: v.pipe(v.string(), v.regex(sha256Pattern)),
      type: v.literal('application/zip'),
    }),
  }),
  v.check((feed) => {
    const release = `${config.repository}/releases`;
    return (
      feed.releaseNotesUrl === `${release}/tag/v${feed.version}` &&
      feed.installationUrl === `${release}/download/v${feed.version}/INSTALL.md` &&
      feed.enclosure.url === `${release}/download/v${feed.version}/lody-chrome.zip`
    );
  }, 'Update links must point to this version in the official repository.'),
);
export type Appcast = v.InferOutput<typeof appcastSchema>;
export const updateStateSchema = v.strictObject({
  lastAttemptAt: v.pipe(v.number(), v.minValue(0)),
  checkedAt: v.nullable(v.pipe(v.number(), v.minValue(0))),
  release: v.nullable(appcastSchema),
  error: v.nullable(v.string()),
  skippedVersion: v.nullable(stableVersionSchema),
});
export type UpdateState = v.InferOutput<typeof updateStateSchema>;
export const emptyUpdateState: UpdateState = {
  lastAttemptAt: 0,
  checkedAt: null,
  release: null,
  error: null,
  skippedVersion: null,
};

export function compareVersions(left: string, right: string) {
  const a = v.parse(versionSchema, left).split('.').map(Number);
  const b = v.parse(versionSchema, right).split('.').map(Number);
  for (let index = 0; index < 4; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function availableRelease(state: UpdateState, installedVersion: string) {
  return state.release && compareVersions(state.release.version, installedVersion) > 0
    ? state.release
    : null;
}

export async function fetchAppcast(request: typeof fetch = globalThis.fetch): Promise<Appcast> {
  const response = await request(feedUrl, {
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'follow',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`更新检查失败：HTTP ${response.status}。`);
  if (!response.url) throw new Error('更新源响应缺少来源地址。');
  const source = new URL(response.url);
  if (source.href !== feedUrl && source.origin !== 'https://release-assets.githubusercontent.com')
    throw new Error('更新源重定向到了未允许的地址。');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('更新源没有返回内容。');
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  try {
    let next = await reader.read();
    while (!next.done) {
      size += next.value.byteLength;
      if (size > 64 * 1024) throw new Error('更新源超过 64 KiB 限制。');
      text += decoder.decode(next.value, { stream: true });
      next = await reader.read();
    }
    text += decoder.decode();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error('更新源不是有效的 JSON。');
  }
  const parsed = v.safeParse(appcastSchema, input);
  if (!parsed.success)
    throw new Error('更新源格式无效：版本、文件信息或发布链接不符合 appcast 协议。');
  return parsed.output;
}
