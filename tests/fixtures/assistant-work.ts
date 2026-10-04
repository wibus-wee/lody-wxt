export const longCommand =
  "rg --files -g '!dist/**' -g '!node_modules/**' -g '!package-lock.json' src/actions/download/artifact/very-long-directory-name ".repeat(
    5,
  );
export const workItems = [
  { type: 'text', text: '先检查仓库约定，再修改工作流。' },
  { type: 'thought', text: '先核对现有约定，避免覆盖已有配置。' },
  ...Array.from({ length: 12 }, (_, index) => ({
    type: 'tool_call',
    toolCallId: `command-${index}`,
    title: index === 0 ? longCommand : `检查工作流文件 ${index + 1}`,
    kind: 'execute',
    status: 'completed',
    content: [
      {
        type: 'terminal_command',
        command: index === 0 ? longCommand : `read workflow-${index + 1}.yml`,
      },
      { type: 'terminal_output', output: `Verified workflow ${index + 1}\n第二行输出完整保留。` },
    ],
  })),
  { type: 'text', text: '仓库检查完成，接下来调整权限。' },
  { type: 'thought', text: '只修改需要的权限范围。' },
  {
    type: 'tool_call',
    toolCallId: 'edit-workflow',
    title: 'Editing files',
    kind: 'edit',
    status: 'completed',
    locations: [{ path: '.github/workflows/ci.yml' }],
    content: [{ type: 'content', content: { type: 'text', text: '权限配置已更新。' } }],
  },
];
export const finalWorkItems = [
  ...workItems,
  { type: 'text', text: '## 工作流已更新\n\n跨仓库分发与 Pages 接入已完成。' },
  { type: 'text', text: '下一步可以从 GitHub Actions 查看执行结果。' },
];
