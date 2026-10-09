import { defineSequenceSteps, validateSequenceSteps } from '@wibus/cuelens';

export const introduction = defineSequenceSteps({
  steps: [
    {
      id: 'welcome',
      state: {
        title: '随时问一句',
        body: '打开侧栏就能开始对话。输入问题并发送，Lody 会在第一条消息发送时创建对话。',
      },
    },
    {
      id: 'personalize',
      state: {
        title: '把网页带进对话',
        body: '需要页面上下文时，附上当前网页或选中的文字。你可以先预览，再决定是否发送。',
      },
    },
  ],
});
const issues = validateSequenceSteps(introduction);
if (issues.length) throw new Error(issues.map((issue) => issue.message).join('\n'));
