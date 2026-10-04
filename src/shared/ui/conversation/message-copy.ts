// Ported from Lody ai-gui/message-copy.ts; preserves each segment’s final text run.
import type { MessageContent } from './content';

const neverCollapsedTypes = new Set<MessageContent['type']>([
  'image_group',
  'image',
  'file',
  'plan',
  'goal',
  'proposed_plan',
  'system_notice',
]);
const isNeverCollapsedAssistantItem = (content: MessageContent | undefined): boolean =>
  !!content &&
  (neverCollapsedTypes.has(content.type) ||
    (content.type === 'tool_call' && content.kind === 'switch_mode'));

/**
 * The answer is the final contiguous run of text before the never-collapsed
 * tail, not necessarily the last item. Every adjacent text block in that run
 * stays visible; a non-text item is the boundary between work and the answer.
 */
const getFinalTextRunStart = (items: MessageContent[]): number => {
  let index = items.length - 1;

  while (index >= 0 && isNeverCollapsedAssistantItem(items[index])) {
    index -= 1;
  }

  if (items[index]?.type !== 'text') {
    return items.length;
  }

  while (index > 0 && items[index - 1]?.type === 'text') {
    index -= 1;
  }

  return index;
};

export const shouldCollapseAssistantMessageItem = ({
  content,
  index,
  items,
  isTurnFinished,
}: {
  content: MessageContent;
  index: number;
  items: MessageContent[];
  isTurnFinished: boolean;
}): boolean => {
  const itemCount = items.length;
  const visibleTextRunStart = getFinalTextRunStart(items);

  return (
    isTurnFinished &&
    itemCount > 1 &&
    index < itemCount - 1 &&
    !(content.type === 'text' && index >= visibleTextRunStart) &&
    !isNeverCollapsedAssistantItem(content)
  );
};
