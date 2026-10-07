import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { DraftAttachments } from './DraftAttachments';

const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
  (character) => character.charCodeAt(0),
);
const image = {
  id: 'screenshot',
  name: '区域截图.png',
  mimeType: 'image/png',
  lastModified: 0,
  source: new Blob([png], { type: 'image/png' }),
};
const meta = {
  title: 'Chat/Draft attachments',
  component: DraftAttachments,
  args: { items: [image], disabled: false, onRemove: fn() },
} satisfies Meta<typeof DraftAttachments>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Screenshot: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const preview = await canvas.findByRole('button', { name: '预览 区域截图.png' });
    const card = preview.closest('div')!.parentElement!;
    await expect(getComputedStyle(card).padding).toBe('6px');
    await expect(getComputedStyle(card).gap).toBe('4px');
    await expect(preview.getBoundingClientRect().width).toBe(64);
    await expect(card.getBoundingClientRect().height).toBeLessThan(112);
    await userEvent.click(preview);
    const dialog = await within(document.body).findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('img', { name: image.name })).toBeVisible(),
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await userEvent.click(canvas.getByRole('button', { name: '移除 区域截图.png' }));
    await expect(args.onRemove).toHaveBeenCalledWith('screenshot');
  },
};
export const Uploading: Story = {
  args: { progress: { id: image.id, percent: 42, phase: 'uploading' }, disabled: true },
};
export const MixedFiles: Story = {
  args: {
    items: [
      image,
      {
        id: 'document',
        name: '一份较长文件名的资料.txt',
        mimeType: 'text/plain',
        lastModified: 0,
        source: new Blob(['A document selected for the draft.'], { type: 'text/plain' }),
      },
    ],
  },
};
