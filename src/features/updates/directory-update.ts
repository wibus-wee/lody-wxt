import type { Appcast } from './appcast';
import { downloadUpdateFiles, fetchUpdateIndex, sha256 } from './archive';
import type { InstallationIdentity } from './directory-binding';
import {
  bindInstallationDirectory,
  boundInstallationDirectory,
  verifyInstallationDirectory,
} from './directory-binding';
import {
  applyDirectoryUpdate,
  directoryUpdateStatus,
  finishDirectoryUpdate,
  prepareDirectoryUpdate,
  rollbackDirectoryUpdate,
} from './directory-transaction';

export type DirectoryAction =
  | { kind: 'bind'; selected: Promise<FileSystemDirectoryHandle>; identity: InstallationIdentity }
  | {
      kind: 'update';
      directory: FileSystemDirectoryHandle | null;
      release: Appcast | null;
      identity: InstallationIdentity;
    }
  | { kind: 'resume' }
  | { kind: 'rollback' };

export async function performDirectoryAction({
  action,
  signal,
  progress,
}: {
  action: DirectoryAction;
  signal: AbortSignal;
  progress: (message: string) => void;
}): Promise<string> {
  if (action.kind === 'bind') {
    const directory = await action.selected;
    signal.throwIfAborted();
    await bindInstallationDirectory(directory, action.identity);
    return `已绑定目录：${directory.name}`;
  }
  if (action.kind === 'resume') {
    await applyDirectoryUpdate(signal);
    return '更新已写入，请完成当前会话后重新加载扩展。';
  }
  if (action.kind === 'rollback') {
    await rollbackDirectoryUpdate();
    return '已恢复更新前的文件。';
  }
  const { directory, release, identity } = action;
  if (!directory || !release) throw new Error('请先选择安装目录并检查更新。');
  progress('正在验证安装目录…');
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
  progress('正在下载并校验变化文件…');
  const result = await downloadUpdateFiles(release, index, unchanged, signal);
  signal.throwIfAborted();
  await prepareDirectoryUpdate(directory, release, index, result.files);
  progress('正在写入更新，恢复备份已保存…');
  await applyDirectoryUpdate(signal);
  return `已写入 ${release.version}，下载 ${result.transferred.toLocaleString()} 字节${result.full ? '（完整包回退）' : '（增量）'}。请完成当前会话后重新加载扩展。`;
}

// Reading status must preserve recovery controls even when the browser revokes
// directory permission after an extension reload. Never discard the journal on error.
export async function readDirectoryUpdateState(identity: InstallationIdentity) {
  const [directory, initialPending] = await Promise.all([
    boundInstallationDirectory(identity.id),
    directoryUpdateStatus(),
  ]);
  let pending = initialPending;
  let recoveryError: string | null = null;
  if (pending?.phase === 'applied' && pending.version === identity.version) {
    try {
      await finishDirectoryUpdate(identity.version);
      pending = await directoryUpdateStatus();
    } catch (error) {
      recoveryError =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? '目录访问权限已失效。请重新授权原目录，校验完成前会保留恢复记录。'
          : `更新校验未完成，恢复记录已保留：${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return { directory, pending, recoveryError };
}
