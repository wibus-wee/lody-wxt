import type { Meta, StoryObj } from '@storybook/react-vite';

import { RunConfigMenu } from './RunConfigMenu';

const meta = {
  title: 'Chat/Run configuration',
  component: RunConfigMenu,
  parameters: { layout: 'centered' },
  args: {
    disabled: false,
    agentLocked: false,
    agent: { cliType: 'builtin', agentType: 'codex' },
    agentLabel: 'Codex',
    agentId: 'codex',
    agents: [
      { value: 'codex', label: 'Codex', cliType: 'builtin', agentType: 'codex' },
      { value: 'claude', label: 'Claude', cliType: 'builtin', agentType: 'claude' },
      { value: 'gemini', label: 'Gemini', cliType: 'registry', agentType: 'gemini' },
    ],
    models: [{ value: 'astra', label: '6 Astra' }],
    modelId: 'astra',
    reasoningOptions: [{ value: 'high', label: 'High' }],
    reasoningEffort: 'high',
    onModelChange: () => {},
    onReasoningChange: () => {},
    onPlanChange: () => {},
    onFastChange: () => {},
  },
} satisfies Meta<typeof RunConfigMenu>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Codex: Story = {};
export const Claude: Story = {
  args: {
    agent: { cliType: 'builtin', agentType: 'claude' },
    agentLabel: 'Claude',
    agentId: 'claude',
    models: [{ value: 'sonnet', label: 'Sonnet' }],
    modelId: 'sonnet',
  },
};
export const DeepSeek: Story = {
  args: {
    agent: { cliType: 'builtin', agentType: 'claude', brandId: 'deepseek' },
    agentLabel: 'DeepSeek',
    agentLocked: true,
    models: [{ value: 'deepseek', label: 'DeepSeek' }],
    modelId: 'deepseek',
  },
};
export const Custom: Story = {
  args: {
    agent: { cliType: 'custom', agentType: 'local' },
    agentLabel: 'Local agent',
    agentLocked: true,
    models: [],
    modelId: '',
    reasoningOptions: [],
  },
};
