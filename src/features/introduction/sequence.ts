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
        title: '带上网页一起聊',
        body: '点击输入框旁的加号附加当前网页或选中文字。点击资料标签可预览内容，发送前随时移除。',
      },
    },
    {
      id: 'ready',
      state: {
        title: '接着上次聊',
        body: '顶部的历史按钮可以搜索并继续对话。新对话沿用你选好的助手，设置和历史切换不会丢掉草稿。',
      },
    },
  ],
});
const issues = validateSequenceSteps(introduction);
if (issues.length) throw new Error(issues.map((issue) => issue.message).join('\n'));
