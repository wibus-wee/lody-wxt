import type { Meta, StoryObj } from '@storybook/react-vite';
import * as stylex from '@stylexjs/stylex';
import { expect, userEvent, within } from 'storybook/test';

import { transcriptFixture } from '../../../tests/fixtures/transcript';
import { ThemeRoot, Tooltip } from '../../shared/ui';
import { composer, composerDark, composerLight } from '../../shared/ui/composer.stylex';
import { messageSurface } from '../../shared/ui/message.stylex';
import { syntaxDark, syntaxLight } from '../../shared/ui/message.tokens.stylex';
import { MessageView } from './MessageView';

const layout = stylex.create({
  canvas: { width: 360, backgroundColor: composer.canvas, color: composer.label },
});
const fixture = transcriptFixture();
const meta = {
  title: 'Lody Chrome/Messages',
  component: MessageView,
  args: { message: fixture.messages[1]! },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MessageView>;
export default meta;
function Transcript({ dark = false }: { dark?: boolean }) {
  return (
    <ThemeRoot mode={dark ? 'dark' : 'light'}>
      <Tooltip.Provider>
        <main
          {...stylex.props(
            layout.canvas,
            dark ? composerDark : composerLight,
            dark ? syntaxDark : syntaxLight,
          )}
        >
          <div {...stylex.props(messageSurface.column)}>
            {fixture.messages.map((message) => (
              <MessageView key={message.id} message={message} />
            ))}
          </div>
        </main>
      </Tooltip.Provider>
    </ThemeRoot>
  );
}
export const Light: StoryObj<typeof meta> = { render: () => <Transcript /> };
export const Dark: StoryObj<typeof meta> = { render: () => <Transcript dark /> };
export const Interactions: StoryObj<typeof meta> = {
  ...Light,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: '展开全部' }));
    await expect(canvas.getByRole('button', { name: '收起' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await userEvent.click(canvas.getByRole('button', { name: '已工作 12 秒' }));
    await userEvent.click(canvas.getByRole('button', { name: '读取源码（演示）' }));
    await expect(
      canvas.getByText('src/features/chat/MessageView.tsx', { exact: true }),
    ).toBeVisible();
    await userEvent.click(canvas.getAllByRole('button', { name: '代码自动换行' })[0]!);
    await expect(canvas.getAllByRole('button', { name: '代码自动换行' })[0]!).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  },
};
export const Streaming: StoryObj<typeof meta> = {
  render: () => (
    <ThemeRoot mode="light">
      <Tooltip.Provider>
        <main {...stylex.props(layout.canvas, composerLight, syntaxLight, messageSurface.column)}>
          <MessageView
            message={{ ...fixture.messages[1]!, status: 'streaming', endedAt: undefined }}
          />
        </main>
      </Tooltip.Provider>
    </ThemeRoot>
  ),
};
export const StoppedToolOnly: StoryObj<typeof meta> = {
  render: () => (
    <ThemeRoot mode="light">
      <Tooltip.Provider>
        <main {...stylex.props(layout.canvas, composerLight, syntaxLight, messageSurface.column)}>
          <MessageView message={{ ...fixture.messages[1]!, status: 'stopped', text: '' }} />
        </main>
      </Tooltip.Provider>
    </ThemeRoot>
  ),
};
