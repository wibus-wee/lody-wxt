import type { Meta, StoryObj } from '@storybook/react-vite';

import type { UpdateState } from './appcast';
import { emptyUpdateState } from './appcast';
import config from './config.json' with { type: 'json' };
import { UpdateNotice } from './UpdateNotice';

const state: UpdateState = {
  ...emptyUpdateState,
  checkedAt: 1_790_000_000_000,
  lastAttemptAt: 1_790_000_000_000,
  release: {
    schemaVersion: config.schemaVersion,
    application: config.application,
    channel: config.channel,
    version: '0.2.0',
    releaseNotesUrl: `${config.repository}/releases/tag/v0.2.0`,
    installationUrl: `${config.repository}/releases/download/v0.2.0/INSTALL.md`,
    enclosure: {
      url: `${config.repository}/releases/download/v0.2.0/lody-chrome.zip`,
      length: 4_000_000,
      sha256: 'a'.repeat(64),
      type: 'application/zip',
    },
  },
};
const meta = {
  title: 'Extension/Updates',
  component: UpdateNotice,
  args: {
    installedVersion: '0.1.0',
    state,
    busy: false,
    error: null,
    check: () => {},
    skip: () => {},
  },
} satisfies Meta<typeof UpdateNotice>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Available: Story = {};
export const Skipped: Story = { args: { state: { ...state, skippedVersion: '0.2.0' } } };
export const Checking: Story = { args: { busy: true } };
export const FailedWithConfirmedRelease: Story = {
  args: { state: { ...state, error: '更新检查失败：HTTP 503。' } },
};
export const FirstCheckFailed: Story = {
  args: { state: { ...emptyUpdateState, error: '更新源不是有效的 JSON。' } },
};
