import { expect, it } from 'vitest';

import { buildAssistantTurnRenderLayout } from '../../src/shared/ui/conversation/assistant-turn-render-blocks';
import { readConversationContent } from '../../src/shared/ui/conversation/content';
import { toolContent } from '../../src/shared/ui/conversation/tool-content';

it('keeps plan approval and implementation as separate regions with their own final text runs', () => {
  const items = readConversationContent([
    { type: 'text', text: 'Inspecting the repository.' },
    { type: 'tool_call', toolCallId: 'read', kind: 'read', locations: [{ path: 'README.md' }] },
    { type: 'proposed_plan', markdown: '## Plan\nChange the workflow.' },
    { type: 'tool_call', toolCallId: 'approve', kind: 'switch_mode' },
    { type: 'text', text: 'Implementing the approved plan.' },
    { type: 'tool_call', toolCallId: 'edit', kind: 'edit', locations: [{ path: 'ci.yml' }] },
    { type: 'text', text: 'Workflow updated.' },
    { type: 'text', text: 'Validation passed.' },
    { type: 'file', path: 'ci.yml' },
  ]);
  const layout = buildAssistantTurnRenderLayout('turn', items, true);
  expect(layout.segments).toHaveLength(2);
  const visible = layout.blocks.filter(
    (block) => block.kind === 'content' && !layout.workBlockKeys.has(block.key),
  );
  expect(
    visible.map((block) => (block.kind === 'content' ? block.entry.content.type : '')),
  ).toEqual(['proposed_plan', 'tool_call', 'text', 'text', 'file']);
  expect(buildAssistantTurnRenderLayout('turn', items, false).workBlockKeys.size).toBe(0);
});

it('retains malformed and future content as inspectable data without inventing text or successful tools', () => {
  const unknown = { type: 'future_activity', payload: { count: 42 } };
  const malformed = { type: 'tool_call', title: 'Missing identity' };
  expect(readConversationContent([unknown, malformed])).toEqual([
    { type: 'unsupported', raw: unknown },
    { type: 'unsupported', raw: malformed },
  ]);
});

it('keeps actual tool output when its raw input or output is a primitive', () => {
  expect(
    toolContent({
      rawInput: 'query',
      rawOutput: 'result',
      content: [{ type: 'terminal_output', output: 'Actual output' }],
    }),
  ).toMatchObject({ command: '"query"', output: 'Actual output' });
});
