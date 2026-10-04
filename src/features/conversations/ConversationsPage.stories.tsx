import type { Meta, StoryObj } from '@storybook/react-vite';

import { ConversationsPage } from './ConversationsPage';

const meta = {
  title: 'Conversations/Workspace',
  component: ConversationsPage,
} satisfies Meta<typeof ConversationsPage>;

export default meta;
export const Workspace: StoryObj<typeof meta> = {};
