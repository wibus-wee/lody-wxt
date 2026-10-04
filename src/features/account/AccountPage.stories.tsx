import type { Meta, StoryObj } from '@storybook/react-vite';

import { AccountPage } from './AccountPage';

const meta = {
  title: 'Account/Device authorization',
  component: AccountPage,
} satisfies Meta<typeof AccountPage>;

export default meta;
export const SignIn: StoryObj<typeof meta> = {};
