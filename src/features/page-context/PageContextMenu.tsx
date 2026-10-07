import { colors } from '@lody/ui/tokens/colors.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';

import { Icon } from '../../shared/icons/Icon';
import { Button, Input, Menu } from '../../shared/ui';
import { Dialog } from '../../shared/ui/dialog';
import { capturePage, createLinkContext } from './capture';
import { fetchSelectedImage } from './image';
import type { PageContextIntent } from './intents';
import { dismissPageIntent, pendingPageIntents, watchPageIntents } from './intents';
import { LibraryPicker } from './LibraryPicker';
import type { PageContext } from './model';
import { PdfImportDialog } from './PdfImportDialog';
import { captureAndCropVisiblePage } from './screenshot-selection';
import type { PageSource } from './SourcePickerDialog';
import { SourcePickerDialog } from './SourcePickerDialog';
import { captureVideoTranscript } from './video';

const styles = stylex.create({
  status: {
    fontSize: 12,
    lineHeight: 1.4,
    color: colors.secondaryLabel,
    overflowWrap: 'anywhere',
    maxWidth: 260,
  },
  source: {
    fontSize: 13,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    maxHeight: 200,
    overflowY: 'auto',
  },
});

export function PageContextMenu({
  onAdd,
  onImage,
  onDocument,
  onFiles,
  onError,
  maxRemaining,
  disabled = false,
  scope,
}: {
  onAdd: (context: PageContext) => void | Promise<void>;
  onImage?: ((file: File) => void | Promise<void>) | undefined;
  onDocument?: ((file: File) => void | Promise<void>) | undefined;
  onFiles?: (() => void) | undefined;
  onError: (message: string) => void;
  maxRemaining: number;
  disabled?: boolean;
  scope: string;
}) {
  const lifetimeRef = useRef<{ scope: string; controller: AbortController } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetimeRef.current = { scope, controller };
    return () => controller.abort();
  }, [scope]);
  function assertActive() {
    const lifetime = lifetimeRef.current;
    if (!lifetime || lifetime.scope !== scope || lifetime.controller.signal.aborted)
      throw new DOMException('Draft context changed', 'AbortError');
  }
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [panel, setPanel] = useState<'sources' | 'link' | 'library' | 'pdf' | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [intents, setIntents] = useState<PageContextIntent[]>([]);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void pendingPageIntents()
        .then((value) => {
          if (live) setIntents(value);
        })
        .catch(() => {
          if (live) onError('右键资料读取失败，请重新打开侧栏后重试。');
        });
    };
    refresh();
    const unsubscribe = watchPageIntents(refresh);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [scope, onError]);
  async function act(action: () => Promise<void>) {
    const lifetime = lifetimeRef.current;
    assertActive();
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (!lifetime?.controller.signal.aborted)
        onError(error instanceof Error ? error.message : '无法附加资料，请重试。');
    } finally {
      if (!lifetime?.controller.signal.aborted) setBusy(false);
    }
  }
  async function add(context: PageContext) {
    assertActive();
    if (maxRemaining < 1) throw new Error('网页资料已达上限，请先移除不需要的资料。');
    await onAdd(context);
  }
  function chooseSource(source: PageSource) {
    switch (source) {
      case 'link':
      case 'library':
      case 'pdf':
        setPanel(source);
        return;
      default:
        break;
    }
    setPanel(null);
    void act(async () => {
      await add(source === 'video' ? await captureVideoTranscript() : await capturePage(source));
    });
  }
  const intent = intents[0];
  async function dismiss() {
    if (!intent) return;
    await dismissPageIntent(intent.id);
    setIntents((current) => current.filter((value) => value.id !== intent.id));
  }
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          render={
            <Button
              ref={triggerRef}
              variant="ghost"
              size="small"
              icon
              disabled={disabled || busy}
              aria-label="附加上下文"
            />
          }
        >
          <Icon name="plus" size={16} />
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item disabled={!onFiles} onClick={onFiles}>
            附加图片或文件…
          </Menu.Item>
          <Menu.Item
            disabled={!onImage}
            onClick={() =>
              void act(async () => {
                const file = await captureAndCropVisiblePage(
                  lifetimeRef.current!.controller.signal,
                );
                assertActive();
                if (file) await onImage?.(file);
              })
            }
          >
            截图并裁剪…
          </Menu.Item>
          <Menu.Item onClick={() => setPanel('sources')}>其他资料来源…</Menu.Item>
        </Menu.Content>
      </Menu.Root>
      {panel === 'sources' && (
        <SourcePickerDialog
          onSelect={chooseSource}
          onClose={() => setPanel(null)}
          maxRemaining={maxRemaining}
          documentAvailable={Boolean(onDocument)}
          finalFocus={triggerRef}
        />
      )}
      {panel === 'pdf' && onDocument && (
        <PdfImportDialog
          onDocument={async (file) => {
            assertActive();
            await onDocument(file);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'library' && <LibraryPicker onAdd={add} onClose={() => setPanel(null)} />}
      {panel === 'link' && (
        <Dialog.Root
          open
          onOpenChange={(open) => {
            if (!open) setPanel(null);
          }}
        >
          <Dialog.Content>
            <Dialog.Title>附加链接</Dialog.Title>
            <Dialog.Description>
              只附加地址，不读取网页。仅保留已批准的视频编号、时间戳和文档定位信息，其他参数会移除。
            </Dialog.Description>
            <Input
              aria-label="网页链接"
              type="url"
              placeholder="https://…"
              value={link}
              onChange={(event) => setLink(event.target.value)}
            />
            <Dialog.Footer>
              <Button variant="ghost" onClick={() => setPanel(null)}>
                取消
              </Button>
              <Button
                disabled={!link.trim() || busy}
                onClick={() =>
                  void act(async () => {
                    await add(createLinkContext(link));
                    setPanel(null);
                    setLink('');
                  })
                }
              >
                附加地址
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
      {intent && !disabled && (
        <Dialog.Root
          open
          onOpenChange={(open) => {
            if (!open) void dismiss();
          }}
        >
          <Dialog.Content>
            <Dialog.Title>{intent.error ? '未能读取来源' : '附加右键选择的资料'}</Dialog.Title>
            <Dialog.Description>
              资料来自触发右键菜单时的页面。加入草稿后仍需点击发送。
            </Dialog.Description>
            {intent.error && (
              <p role="alert" {...stylex.props(styles.status)}>
                {intent.error}
              </p>
            )}
            {intent.context && (
              <>
                <p {...stylex.props(styles.status)}>
                  {intent.context.title} · {new URL(intent.context.url).hostname}
                </p>
                <p {...stylex.props(styles.source)}>{intent.context.text}</p>
              </>
            )}
            {intent.imageUrl && (
              <p {...stylex.props(styles.source)}>
                已选择网页中的一张图片。点击加入后申请该图片网站的访问权限，并读取真实图片；不会截取整个页面。
              </p>
            )}
            <Dialog.Footer>
              <Button variant="ghost" disabled={busy} onClick={() => void dismiss()}>
                关闭
              </Button>
              {intent.imageUrl && onImage && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      if (intent.imageUrl) {
                        const file = await fetchSelectedImage(intent.imageUrl);
                        assertActive();
                        await onImage(file);
                      }
                      await dismiss();
                    })
                  }
                >
                  读取图片并加入
                </Button>
              )}
              {intent.context && (
                <Button
                  disabled={busy || !maxRemaining}
                  onClick={() =>
                    void act(async () => {
                      if (intent.context) await add(intent.context);
                      await dismiss();
                    })
                  }
                >
                  加入草稿
                </Button>
              )}
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </>
  );
}
