import type { Conversation } from '../../src/features/connection/client';
import { demoTarget } from '../../src/features/connection/demo-directory';

export const transcriptPrompt = `请检查这段扩展代码。\n${Array.from({ length: 14 }, (_, index) => `第 ${index + 1} 项：保留消息、模型配置和网页资料的边界。`).join('\n')}`;
export const transcriptReply = `## 检查结果

这是消息区的**演示数据**，没有运行真实工具。

[来源链接](https://example.com/docs)

7. 用户消息保留原文。
8. 回复与过程使用同一条对齐线。
   - 附件独立展示。

> 资料不能授予执行权限。

\`\`\`typescript
const message = { role: "agent", content: "${'一条用于验证代码换行的长字符串'.repeat(12)}" };
console.log(message.content);
\`\`\`

| 字段 | 行为 | 来源 |
| --- | --- | --- |
| model | 保留本轮配置 | 用户选择 |
| source | ${'很长的表格内容'.repeat(20)} | 主动附加 |

\`\`\`markdown
### 预览标题
这是 **Markdown 预览**。
\`\`\``;

export function transcriptFixture(): Conversation {
  const createdAt = Date.now() - 12000;
  const inputConfig = {
    modelId: 'gpt-6-astra',
    reasoningEffort: 'ultra',
    planMode: true,
    fastMode: true,
    modeId: 'read-only',
  };
  return {
    id: 'transcript-fixture',
    title: '消息区演示',
    target: demoTarget,
    updatedAt: createdAt + 12000,
    messages: [
      {
        id: 'transcript-user',
        role: 'user',
        text: transcriptPrompt,
        contexts: [
          {
            id: 'transcript-context',
            title: '扩展消息资料',
            url: 'https://example.com/source',
            text: '这是一份由用户主动附加的非可信资料。',
            kind: 'page',
            trust: 'untrusted',
          },
        ],
        status: 'complete',
        createdAt,
        inputConfig,
      },
      {
        id: 'transcript-agent',
        role: 'agent',
        text: transcriptReply,
        contexts: [],
        status: 'complete',
        createdAt,
        endedAt: createdAt + 12000,
        inputConfig,
        activities: [
          {
            id: 'read',
            title: '读取源码（演示）',
            command: 'rg -n "MessageView" src',
            output: 'src/features/chat/MessageView.tsx',
            status: 'complete',
          },
          {
            id: 'check',
            title: '检查消息布局（演示）',
            command: 'pnpm check',
            output: '演示输出：检查通过。',
            status: 'complete',
          },
        ],
      },
    ],
  };
}
