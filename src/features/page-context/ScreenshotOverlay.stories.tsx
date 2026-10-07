import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ScreenshotOverlay } from './ScreenshotOverlay';

const meta = {
  title: 'Chat/Screenshot overlay',
  component: ScreenshotOverlay,
  parameters: { layout: 'fullscreen' },
  args: {
    // A solid bitmap represents the frozen viewport in this UI-only preview.
    data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    width: 1280,
    height: 720,
    onSelect: fn(),
  },
} satisfies Meta<typeof ScreenshotOverlay>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SelectRegion: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.clear(canvas.getByLabelText('宽度（像素）'));
    await userEvent.type(canvas.getByLabelText('宽度（像素）'), '120');
    await userEvent.clear(canvas.getByLabelText('高度（像素）'));
    await userEvent.type(canvas.getByLabelText('高度（像素）'), '80');
    await userEvent.click(canvas.getByRole('button', { name: '附加裁剪区域' }));
    await expect(args.onSelect).toHaveBeenCalledWith({
      type: 'crop',
      region: { x: 0, y: 0, width: 120, height: 80 },
    });
  },
};
export const FullScreenshot: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '附加整张截图' }));
    await expect(args.onSelect).toHaveBeenCalledWith({ type: 'full' });
  },
};
