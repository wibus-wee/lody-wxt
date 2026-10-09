import type { Meta, StoryObj } from '@storybook/react-vite';

import { Tooltip } from '../../shared/ui';
import { UpdateSettingsLinkView } from './UpdateSettingsLink';

const meta = {
  title: 'Extension/Update indicator',
  component: UpdateSettingsLinkView,
  decorators: [
    (Story) => (
      <Tooltip.Provider>
        <Story />
      </Tooltip.Provider>
    ),
  ],
  args: { version: null },
} satisfies Meta<typeof UpdateSettingsLinkView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Current: Story = {};
export const Available: Story = { args: { version: '0.2.0' } };
export const LastConfirmed: Story = {
  args: { version: '0.2.0', previousCheckFailed: true },
};
