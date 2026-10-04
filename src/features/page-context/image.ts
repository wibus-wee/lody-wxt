import { browser } from 'wxt/browser';

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const maxBytes = 20 * 1024 * 1024;

export async function fetchSelectedImage(value: string): Promise<File> {
  const url = new URL(value);
  if (!new Set(['https:', 'http:']).has(url.protocol) || url.username || url.password)
    throw new Error('只支持普通网页上的图片地址。');
  const origins = [`${url.origin}/*`];
  if (
    !(await browser.permissions.contains({ origins })) &&
    !(await browser.permissions.request({ origins }))
  )
    throw new Error('未获得图片所在网站的访问权限。');
  const response = await fetch(url.href, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || !response.body)
    throw new Error('无法读取图片。需要登录或跳转的图片请保存后上传。');
  const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!imageTypes.has(type)) throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 图片。');
  if (Number(response.headers.get('content-length')) > maxBytes)
    throw new Error('图片超过 20 MB，请保存后压缩再上传。');
  const reader = response.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    let next = await reader.read();
    while (!next.done) {
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error('图片超过 20 MB，请保存后压缩再上传。');
      parts.push(new Uint8Array(next.value));
      next = await reader.read();
    }
  } finally {
    await reader.cancel();
  }
  const suffix = type === 'image/jpeg' ? 'jpg' : type.slice(6);
  const file = new File(parts, `网页图片.${suffix}`, { type });
  const bitmap = await createImageBitmap(file);
  bitmap.close();
  return file;
}
