import type { Meta, StoryObj } from '@storybook/react-vite';
import * as stylex from '@stylexjs/stylex';
import { expect, userEvent, within } from 'storybook/test';

import { App } from './App';

const modelMenuRow = /^模型 /;

const layouts = stylex.create({
  narrow: { width: 360 },
  sidebar: { width: 480 },
  popup: { width: 380 },
});
const meta = {
  title: 'Lody Chrome/Surfaces',
  component: App,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof App>;
export default meta;
export const Workspace: StoryObj<typeof meta> = {};
export const NarrowSidebar: StoryObj<typeof meta> = {
  render: () => (
    <div {...stylex.props(layouts.narrow)}>
      <App surface="sidepanel" />
    </div>
  ),
};
export const Sidebar: StoryObj<typeof meta> = {
  render: () => (
    <div {...stylex.props(layouts.sidebar)}>
      <App surface="sidepanel" />
    </div>
  ),
};
export const DarkSidebar: StoryObj<typeof meta> = {
  ...NarrowSidebar,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('link', { name: 'Settings' }));
    await userEvent.click(await canvas.findByRole('combobox', { name: 'Theme' }));
    await userEvent.click(await within(document.body).findByRole('option', { name: 'dark' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(canvas.getByRole('link', { name: 'Workspace' }));
    await expect(canvas.getByRole('textbox', { name: '消息' })).toBeVisible();
  },
};
export const Conversation: StoryObj<typeof meta> = {
  ...Sidebar,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = await canvas.findByRole('textbox', { name: '消息' });
    await userEvent.type(composer, '请帮我整理这篇网页的重点。');
    await userEvent.click(canvas.getByRole('button', { name: '发送消息' }));
    await expect(await canvas.findByRole('article', { name: '你的消息' })).toBeVisible();
    await expect(await canvas.findByRole('article', { name: 'Agent 消息' })).toBeVisible();
  },
};
export const ComposerWithContext: StoryObj<typeof meta> = {
  ...NarrowSidebar,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: '附加上下文' }));
    await userEvent.click(
      await within(document.body).findByRole('menuitem', { name: '附加演示页面' }),
    );
    const composer = canvas.getByTestId('composer');
    await expect(within(composer).getByTestId('context-card')).toBeVisible();
    await userEvent.type(
      canvas.getByRole('textbox', { name: '消息' }),
      '请帮我整理这篇网页的重点。',
    );
    await userEvent.click(canvas.getByRole('button', { name: '运行配置' }));
    await expect(
      await within(document.body).findByRole('menuitem', { name: '模型 6.1 Sol' }),
    ).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect(canvas.getByRole('textbox', { name: '消息' })).toHaveFocus();
  },
};
export const Options: StoryObj<typeof meta> = { args: { surface: 'options' } };
export const RunConfiguration: StoryObj<typeof meta> = {
  ...NarrowSidebar,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(await canvas.findByRole('button', { name: '运行配置' }));
    await userEvent.click(await body.findByRole('menuitem', { name: modelMenuRow }));
    await userEvent.type(await body.findByRole('textbox', { name: '搜索模型' }), 'astra');
    const model = await body.findByRole('menuitemradio', { name: '6 Astra' });
    await userEvent.click(model);
    await expect(model).toBeChecked();
    await userEvent.keyboard('{Escape}{Escape}');
    await userEvent.click(canvas.getByRole('button', { name: '运行配置' }));
    const plan = await body.findByRole('menuitemcheckbox', { name: 'Plan' });
    await userEvent.click(plan);
    await expect(plan).toBeChecked();
    await expect(await body.findByRole('menuitem', { name: '模型 6 Astra' })).toBeVisible();
  },
};
export const Popup: StoryObj<typeof meta> = {
  render: () => (
    <div {...stylex.props(layouts.popup)}>
      <App surface="popup" />
    </div>
  ),
};

export const PermissionSelection: StoryObj<typeof meta> = {
  ...NarrowSidebar,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(await canvas.findByRole('button', { name: '权限：Auto review' }));
    await userEvent.click(await body.findByRole('menuitemradio', { name: 'Full access' }));
    await expect(await canvas.findByRole('button', { name: '权限：Full access' })).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: '消息' })).toHaveFocus();
    await userEvent.click(canvas.getByRole('button', { name: '权限：Full access' }));
    await expect(await body.findByRole('menuitemradio', { name: 'Full access' })).toBeChecked();
  },
};
