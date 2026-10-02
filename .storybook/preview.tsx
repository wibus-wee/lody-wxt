import '../src/app/global.css';

import type { Preview } from '@storybook/react-vite';

import { AppProviders } from '../src/app/providers';

const preview: Preview = {
  decorators: [
    (Story) => (
      <AppProviders>
        <Story />
      </AppProviders>
    ),
  ],
  parameters: { a11y: { test: 'error' } },
};
export default preview;
