import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { DirectoryUpdateView } from './DirectoryUpdateView';

const meta = {
  title: 'Extension/Directory update',
  component: DirectoryUpdateView,
  args: {
    directoryName: null,
    pending: null,
    busy: false,
    needsPermission: false,
    authorize: fn(),
    canUpdate: false,
    message: null,
    error: null,
    bind: fn(),
    update: fn(),
    resume: fn(),
    rollback: fn(),
    cancel: fn(),
  },
} satisfies Meta<typeof DirectoryUpdateView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Unbound: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '下载并写入更新' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: '选择安装目录' }));
    await expect(args.bind).toHaveBeenCalled();
  },
};
export const Available: Story = { args: { directoryName: 'lody', canUpdate: true } };
export const Downloading: Story = {
  args: { directoryName: 'lody', busy: true, message: '正在下载并校验变化文件…' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '下载并写入更新' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: '停止，保留恢复记录' }));
    await expect(args.cancel).toHaveBeenCalled();
  },
};
export const Interrupted: Story = {
  args: {
    directoryName: 'lody',
    pending: { version: '0.2.5', phase: 'prepared' },
    error: '权限已失效，请重新授权原目录。',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '下载并写入更新' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: '重新选择原目录' }));
    await expect(args.bind).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: '恢复更新前文件' }));
    await expect(args.rollback).toHaveBeenCalled();
  },
};
export const AwaitingReload: Story = {
  args: { directoryName: 'lody', pending: { version: '0.2.5', phase: 'applied' } },
};

export const PermissionExpired: Story = {
  args: { directoryName: 'lody', needsPermission: true, canUpdate: false },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('安装目录：lody')).toBeVisible();
    await expect(canvas.getByRole('button', { name: '下载并写入更新' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: '恢复目录授权' }));
    await expect(args.authorize).toHaveBeenCalled();
    await expect(args.bind).not.toHaveBeenCalled();
  },
};
