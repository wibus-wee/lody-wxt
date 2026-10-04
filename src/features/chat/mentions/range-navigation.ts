// Ported from Lody ui/mention/mention-input-core.ts; only the persisted range type differs.
import type { ComposerMentionRange } from './types';

const onlyWhitespace = /^\s*$/u;

type HorizontalNavigationOptions = {
  mentions: readonly ComposerMentionRange[];
  value: string;
  cursorPosition: number;
  direction: 'left' | 'right';
  isWordJump: boolean;
};

export function findAdjacentMentionForHorizontalNavigation({
  mentions,
  value,
  cursorPosition,
  direction,
  isWordJump,
}: HorizontalNavigationOptions): ComposerMentionRange | null {
  const isLeftArrow = direction === 'left';

  return (
    mentions.find((mention) => {
      if (isLeftArrow) {
        const textBetween = value.slice(mention.end, cursorPosition);
        const isOnlySpaces = onlyWhitespace.test(textBetween);

        if (isWordJump) {
          return (
            cursorPosition > mention.start &&
            (cursorPosition === mention.end || (cursorPosition > mention.end && isOnlySpaces))
          );
        }

        return (
          cursorPosition === mention.end ||
          (cursorPosition > mention.end && cursorPosition <= mention.end + 1 && isOnlySpaces)
        );
      }

      const textBetween = value.slice(cursorPosition, mention.start);
      const isOnlySpaces = onlyWhitespace.test(textBetween);

      if (isWordJump) {
        return (
          (cursorPosition >= mention.start && cursorPosition < mention.end) ||
          (cursorPosition < mention.start && isOnlySpaces)
        );
      }

      return (
        cursorPosition === mention.start ||
        (cursorPosition < mention.start && cursorPosition >= mention.start - 1 && isOnlySpaces)
      );
    }) ?? null
  );
}

type BackspaceMentionOptions = {
  mentions: readonly ComposerMentionRange[];
  value: string;
  cursorPosition: number;
  isCtrlOrCmd: boolean;
};

export function findMentionBeforeCursorForDeletion({
  mentions,
  value,
  cursorPosition,
  isCtrlOrCmd,
}: BackspaceMentionOptions): ComposerMentionRange | null {
  return (
    mentions.find((mention) => {
      if (!isCtrlOrCmd) {
        return (
          cursorPosition === mention.end ||
          (cursorPosition === mention.end + 1 && value[mention.end] === ' ') ||
          (cursorPosition > mention.start && cursorPosition <= mention.end)
        );
      }

      const textBetween = value.slice(mention.end, cursorPosition);
      return mention.end <= cursorPosition && onlyWhitespace.test(textBetween);
    }) ?? null
  );
}

export function removeMentionText(
  value: string,
  mention: ComposerMentionRange,
  includeTrailingSpace: boolean,
) {
  return value.slice(0, mention.start) + value.slice(mention.end + (includeTrailingSpace ? 1 : 0));
}
