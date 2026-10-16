import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';

import { isExtension } from '../../shared/storage';
import type { Appcast } from './appcast';
import {
  directoryActionError,
  directoryPermissionMessage,
  directoryPickerAvailable,
  requestInstallationDirectoryPermission,
  selectInstallationDirectory,
} from './directory-binding';
import type { DirectoryAction } from './directory-update';
import { performDirectoryAction, readDirectoryUpdateState } from './directory-update';
import { DirectoryUpdateView } from './DirectoryUpdateView';

const queryKey = ['directory-update'];
export function DirectoryUpdate({ release }: { release: Appcast | null }) {
  const enabled = isExtension() && directoryPickerAvailable();
  const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
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
      return readDirectoryUpdateState(identity);
    },
  });
  const mutation = useMutation({
    mutationFn: performDirectoryAction,
    onSuccess: setMessage,
    onSettled: () => {
      activeRef.current = null;
      return client.invalidateQueries({ queryKey });
    },
  });
  const start = (action: DirectoryAction) => {
    if (activeRef.current) return;
    const controller = new AbortController();
    activeRef.current = controller;
    setMessage(null);
    mutation.mutate({ action, signal: controller.signal, progress: setMessage });
  };
  if (!enabled || !identity) return null;
  const pending = query.data?.pending;
  const bind = () => {
    if (activeRef.current) return;
    // Keep the native picker in the click's transient activation, before any await.
    const selected = selectInstallationDirectory();
    start({ kind: 'bind', selected, identity });
  };
  const directory = query.data?.directory ?? null;
  const needsPermission =
    !!directory &&
    (query.data?.permission !== 'granted' ||
      (mutation.error instanceof DOMException && mutation.error.name === 'NotAllowedError'));
  const authorize = () => {
    if (activeRef.current || !directory) return;
    try {
      const permission = requestInstallationDirectoryPermission(directory);
      start({ kind: 'authorize', directory, permission });
    } catch (error) {
      setMessage(`无法请求目录授权，请重新选择原安装目录：${String(error)}`);
    }
  };
  return (
    <DirectoryUpdateView
      directoryName={query.data?.directory?.name ?? null}
      pending={pending ?? null}
      needsPermission={needsPermission}
      authorize={authorize}
      busy={mutation.isPending}
      canUpdate={!!release && !!directory && !pending && !needsPermission}
      message={message}
      error={
        mutation.error
          ? directoryActionError(mutation.error)
          : query.error
            ? directoryActionError(query.error)
            : needsPermission
              ? directoryPermissionMessage
              : (query.data?.recoveryError ?? null)
      }
      bind={bind}
      update={() =>
        start({ kind: 'update', directory: query.data?.directory ?? null, release, identity })
      }
      resume={() => start({ kind: 'resume', directory })}
      rollback={() => start({ kind: 'rollback', directory })}
      cancel={() => activeRef.current?.abort()}
    />
  );
}
