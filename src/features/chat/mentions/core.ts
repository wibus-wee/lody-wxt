import type { ComposerMentionRange } from './types';

const hasNonWhitespace = /\S/u;
const hasWhitespace = /\s/u;
export const COMPOSER_MAX_LENGTH = 16000;

const triggers = ['@', '/', '、', '$', '￥'];
export interface ComposerMentionQuery {
  trigger: string;
  start: number;
  end: number;
  search: string;
}

// Matches Lody's mention-input trigger boundaries, including a caret in the middle of text.
export function mentionQuery(
  text: string,
  start: number,
  end = start,
): ComposerMentionQuery | null {
  if (start !== end) return null;
  const candidates = triggers
    .map((trigger) => ({ trigger, index: text.lastIndexOf(trigger, start - 1) }))
    .sort((left, right) => right.index - left.index);
  for (const { trigger, index } of candidates) {
    if (index < 0) continue;
    const before = text.slice(0, index);
    if (hasNonWhitespace.test(before) && !new Set([' ', '\n']).has(before.slice(-1))) continue;
    const search = text.slice(index + 1, start);
    if (hasWhitespace.test(search)) continue;
    const next = text[start];
    if (next && !new Set([' ', '\n', ...triggers]).has(next)) continue;
    return { trigger, start: index, end: start, search };
  }
  return null;
}

// Lody's edit rule: ranges after an edit shift; ranges touched by it cease to be mentions.
export function editMentionRanges(
  previous: string,
  next: string,
  ranges: readonly ComposerMentionRange[] = [],
): ComposerMentionRange[] {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let oldEnd = previous.length;
  let newEnd = next.length;
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const delta = newEnd - oldEnd;
  return ranges.flatMap((range) => {
    if (previous.slice(range.start, range.end) !== range.text) return [];
    if (range.end <= start) return [range];
    if (range.start >= oldEnd)
      return [{ ...range, start: range.start + delta, end: range.end + delta }];
    return [];
  });
}

export function expandComposerMentions(
  text: string,
  ranges: readonly ComposerMentionRange[] = [],
  scope?: string,
) {
  let result = text;
  let boundary = text.length;
  for (const range of [...ranges].sort((left, right) => right.start - left.start)) {
    if (
      range.start < 0 ||
      range.end > boundary ||
      range.start >= range.end ||
      text.slice(range.start, range.end) !== range.text
    )
      continue;
    if (range.scope && scope !== range.scope)
      throw new Error('草稿中的提及属于之前的对话助手，请重新选择后发送。');
    result = result.slice(0, range.start) + range.expansion + result.slice(range.end);
    boundary = range.start;
  }
  return result;
}
