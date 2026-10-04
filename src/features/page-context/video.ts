import * as v from 'valibot';
import { browser } from 'wxt/browser';

import { authorizedCaptureTab, publicSourceUrl } from './capture';
import type { PageContext } from './model';
import { parsePageContext } from './model';

export async function captureVideoTranscript(): Promise<PageContext> {
  const tabId = await authorizedCaptureTab();
  const [result] = await browser.scripting.executeScript({
    target: { tabId },
    func: (id: string) => {
      const video = document.querySelector('video');
      if (!video) return { error: '当前页面没有可访问的视频。' };
      const track = Array.from(video.textTracks).find(
        (candidate) =>
          candidate.cues?.length && new Set(['captions', 'subtitles']).has(candidate.kind),
      );
      if (!track?.cues?.length)
        return {
          error:
            '网页没有向浏览器开放可读取的字幕。请开启字幕后重试，或上传字幕文件；不会以页面标题冒充视频内容。',
        };
      const lines = Array.from(track.cues).flatMap((cue) => {
        if (!(cue instanceof VTTCue)) return [];
        const seconds = Math.floor(cue.startTime);
        const stamp = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        return [`[${stamp}] ${cue.getCueAsHTML().textContent ?? ''}`];
      });
      const text = lines.join('\n');
      if (!text.trim()) return { error: '字幕没有可读取的文字。' };
      const url = new URL(location.href);
      url.username = '';
      url.password = '';
      return {
        context: {
          id,
          kind: 'page',
          title: `${document.title} · 字幕 ${track.language}`.slice(0, 200),
          url: url.href,
          text: text.slice(0, 12_000),
          trust: 'untrusted',
          capturedAt: new Date().toISOString(),
          sourceLength: text.length,
          truncated: text.length > 12_000,
        },
      };
    },
    args: [crypto.randomUUID()],
  });
  const parsed = v.parse(
    v.object({ error: v.exactOptional(v.string()), context: v.exactOptional(v.unknown()) }),
    result?.result,
  );
  if (parsed.error) throw new Error(parsed.error);
  return parsePageContext({
    ...parsePageContext({
      ...v.parse(v.looseObject({ url: v.string() }), parsed.context),
      url: publicSourceUrl(v.parse(v.object({ url: v.string() }), parsed.context).url),
    }),
    tabId,
    ...(result?.documentId ? { documentId: result.documentId } : {}),
  });
}

export async function seekCapturedVideo(context: PageContext, seconds: number): Promise<void> {
  if (
    context.tabId === undefined ||
    !context.documentId ||
    !Number.isFinite(seconds) ||
    seconds < 0
  )
    throw new Error('此字幕快照没有可用的本地视频定位，请在来源页面重新采集。');
  const [result] = await browser.scripting.executeScript({
    target: { tabId: context.tabId, documentIds: [context.documentId] },
    func: (time: number) => {
      const video = document.querySelector('video');
      if (!video) return false;
      video.currentTime = time;
      return true;
    },
    args: [seconds],
  });
  if (result?.result !== true) throw new Error('视频页面已变化，请保留快照或重新采集字幕。');
  const tab = await browser.tabs.update(context.tabId, { active: true });
  if (!tab) throw new Error('来源标签页已关闭。');
  await browser.windows.update(tab.windowId, { focused: true });
}
