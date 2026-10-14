import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';

import { isExtension } from '../../shared/storage';
import type { Appcast } from './appcast';
import { downloadUpdateFiles, fetchUpdateIndex, sha256 } from './archive';
import {
  bindInstallationDirectory,
  boundInstallationDirectory,
  directoryPickerAvailable,
  selectInstallationDirectory,
  verifyInstallationDirectory,
} from './directory-binding';
import {
  applyDirectoryUpdate,
  directoryUpdateStatus,
  finishDirectoryUpdate,
  prepareDirectoryUpdate,
  rollbackDirectoryUpdate,
} from './directory-transaction';
import { DirectoryUpdateView } from './DirectoryUpdateView';

const queryKey = ['directory-update'];
export function DirectoryUpdate({ release }: { release: Appcast | null }) {
  const enabled = isExtension() && directoryPickerAvailable();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef<AbortController | null>(null);
  useEffect(() => () => activeRef.current?.abort(), []);
  const identity = enabled
    ? {
        id: browser.runtime.id,
        version: browser.runtime.getManifest().version,
        rootUrl: browser.runtime.getURL(''),
      }
    : null;
  const query = useQuery({
    queryKey,
    enabled,
    retry: false,
    queryFn: async () => {
      if (!identity) throw new Error('扩展更新不可用。');
      const pending = await directoryUpdateStatus();
      if (pending?.phase === 'applied' && pending.version === identity.version)
        await finishDirectoryUpdate(identity.version);
      return {
        directory: await boundInstallationDirectory(identity.id),
        pending: await directoryUpdateStatus(),
      };
    },
  });
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (activeRef.current) return;
    const controller = new AbortController();
    activeRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      await action(controller.signal);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '目录更新失败。');
    } finally {
      activeRef.current = null;
      setBusy(false);
      await client.invalidateQueries({ queryKey });
    }
  };
  if (!enabled || !identity) return null;
  const pending = query.data?.pending;
  const bind = () => {
    if (activeRef.current) return;
    // Do not await anything before opening the picker: the browser requires this click.
    const selected = selectInstallationDirectory();
    void run(async () => {
      const directory = await selected;
      await bindInstallationDirectory(directory, identity);
      setMessage(`已绑定目录：${directory.name}`);
    });
  };
  const update = () =>
    void run(async (signal) => {
      const directory = query.data?.directory;
      if (!directory || !release) throw new Error('请先选择安装目录并检查更新。');
      setMessage('正在验证安装目录…');
      await verifyInstallationDirectory(directory, identity);
      const index = await fetchUpdateIndex(release, signal);
      const unchanged = new Map<string, string>();
      for (const file of index.files) {
        signal.throwIfAborted();
        try {
          const parts = file.path.split('/');
          const name = parts.pop();
          if (!name) throw new Error('无效文件路径。');
          let parent = directory;
          for (const part of parts) parent = await parent.getDirectoryHandle(part);
          const current = await (await parent.getFileHandle(name)).getFile();
          if (current.size === file.size)
            unchanged.set(file.path, await sha256(new Uint8Array(await current.arrayBuffer())));
        } catch (failure) {
          if (!(failure instanceof DOMException) || failure.name !== 'NotFoundError') throw failure;
        }
      }
      setMessage('正在下载并校验变化文件…');
      const result = await downloadUpdateFiles(release, index, unchanged, signal);
      signal.throwIfAborted();
      await prepareDirectoryUpdate(directory, release, index, result.files);
      setMessage('正在写入更新，恢复备份已保存…');
      await applyDirectoryUpdate(signal);
      setMessage(
        `已写入 ${release.version}，下载 ${result.transferred.toLocaleString()} 字节${result.full ? '（完整包回退）' : '（增量）'}。请完成当前会话后重新加载扩展。`,
      );
    });
  return (
    <DirectoryUpdateView
      directoryName={query.data?.directory?.name ?? null}
      pending={pending ?? null}
      busy={busy}
      canUpdate={!!release && !!query.data?.directory && !pending}
      message={message}
      error={error ?? query.error?.message ?? null}
      bind={bind}
      update={update}
      resume={() =>
        void run(async (signal) => {
          await applyDirectoryUpdate(signal);
          setMessage('更新已写入，请完成当前会话后重新加载扩展。');
        })
      }
      rollback={() =>
        void run(async () => {
          await rollbackDirectoryUpdate();
          setMessage('已恢复更新前的文件。');
        })
      }
      cancel={() => activeRef.current?.abort()}
    />
  );
}
