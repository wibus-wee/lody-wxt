import type { Meta, StoryObj } from '@storybook/react-vite';

import { App } from './App';

const meta = { title: 'Foundation/Workspace', component: App } satisfies Meta<typeof App>;
export default meta;
export const Workspace: StoryObj<typeof meta> = {};
