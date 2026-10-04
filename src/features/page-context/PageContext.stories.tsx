import type { Meta, StoryObj } from '@storybook/react-vite';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { userEvent, within } from 'storybook/test';

import { Button } from '../../shared/ui';
import { ContextStrip } from './ContextStrip';
import type { PageContext } from './model';
import { PageContextMenu } from './PageContextMenu';
import { PdfImportDialog } from './PdfImportDialog';
import { SourcePickerDialog } from './SourcePickerDialog';
import { TabContextPicker } from './TabContextPicker';

const styles = stylex.create({ page: { padding: 16, minHeight: 480, width: '100%', minWidth: 0 } });
const snapshot: PageContext = {
  id: 'long-page',
  kind: 'page',
  title: '一篇较长的研究资料与来源快照',
  url: 'https://example.test/research',
  text: '这是已附加的网页内容，保留原始快照供发送前核对。\n正文中隐藏的内容和表单不会被附加。',
  trust: 'untrusted',
  capturedAt: '2026-10-04T08:30:00.000Z',
  truncated: true,
  sourceLength: 24_000,
};
const tabs = [
  { id: 1, title: '第一份研究资料', url: 'https://example.test/first', groupId: -1 },
  { id: 2, title: '无权限读取的网页', url: 'https://private.test/', groupId: -1 },
  {
    id: 3,
    title: '一段很长的标签页标题在窄侧栏中也应当完整换行并保留选择入口',
    url: 'https://example.test/third',
    groupId: -1,
  },
];
const load = async () => tabs;
function Example({
  picker = false,
  pdf = false,
  sources = false,
  menu = false,
  remaining = 3,
}: {
  picker?: boolean;
  pdf?: boolean;
  sources?: boolean;
  menu?: boolean;
  remaining?: number;
}) {
  const [contexts, setContexts] = useState<PageContext[]>([snapshot]);
  const [open, setOpen] = useState(picker || pdf || sources);
  const [notice, setNotice] = useState('');
  return (
    <main {...stylex.props(styles.page)}>
      {(sources || menu) && (
        <p>
          界面预览：文件入口与来源选择仅显示操作结果。网页读取、截图和浏览器权限需在扩展中验证。
        </p>
      )}
      <ContextStrip
        contexts={contexts}
        remove={(id) => setContexts((current) => current.filter((context) => context.id !== id))}
      />
      {(picker || pdf) && (
        <Button onClick={() => setOpen(true)}>{pdf ? '读取 PDF' : '选择标签页'}</Button>
      )}
      {sources && <Button onClick={() => setOpen(true)}>其他资料来源…</Button>}
      {menu && (
        <PageContextMenu
          scope="storybook:attachment-menu"
          maxRemaining={remaining}
          onAdd={(context) => setContexts((current) => [...current, context])}
          onFiles={() => setNotice('预览：打开图片或文件选择器')}
          onImage={() => setNotice('预览：将裁剪后的截图加入草稿')}
          onDocument={() => setNotice('预览：将 PDF 文字加入草稿')}
          onError={setNotice}
        />
      )}
      {notice && <output>{notice}</output>}
      {open && sources && (
        <SourcePickerDialog
          maxRemaining={remaining}
          documentAvailable
          onSelect={(source) => {
            setNotice(`预览：已选择 ${source}，没有读取或发送资料。`);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
      {open && picker && (
        <TabContextPicker
          maxRemaining={3 - contexts.length}
          load={load}
          capture={async (_kind, target) => {
            if (target?.tabId === 2) throw new Error('未获得此网站的访问权限，没有附加任何内容。');
            return {
              ...snapshot,
              id: String(target?.tabId),
              title: tabs.find((tab) => tab.id === target?.tabId)?.title ?? snapshot.title,
            };
          }}
          onAdd={(context) => setContexts((current) => [...current, context])}
          onClose={() => setOpen(false)}
        />
      )}
      {open && pdf && (
        <PdfImportDialog onDocument={() => setOpen(false)} onClose={() => setOpen(false)} />
      )}
    </main>
  );
}
const meta = {
  title: 'Chat/Page context',
  component: Example,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Snapshot: Story = {};
export const SelectTabs: Story = { args: { picker: true } };
export const ReadPdf: Story = { args: { pdf: true } };
export const SourcePicker: Story = { args: { sources: true } };
export const SourceLimitReached: Story = { args: { sources: true, remaining: 0 } };
export const CompactAttachmentMenu: Story = {
  args: { menu: true },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '附加上下文' }));
  },
};
