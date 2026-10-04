import type { AttachmentRequestOptions } from '@lody-mobile/sdk';
import { useEffect, useRef, useState } from 'react';

import type { AttachmentDraft, ReadyAttachment } from './attachment-drafts';
import {
  appendDraftFiles,
  loadAttachmentDraft,
  newAttachmentDraft,
  readyAttachments,
  saveAttachmentDraft,
} from './attachment-drafts';

export function useAttachmentDrafts(key: string, scope: string) {
  const [draft, setDraft] = useState<AttachmentDraft>();
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{
    id: string;
    percent: number;
    phase: 'preparing' | 'uploading' | 'verifying';
  }>();
  const currentRef = useRef<AttachmentDraft | undefined>(undefined);
  const lifetimeRef = useRef<AbortController | undefined>(undefined);
  const transferRef = useRef<AbortController | undefined>(undefined);
  const queueRef = useRef(Promise.resolve());
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const clear = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail !== scope) return;
      lifetimeRef.current?.abort();
      transferRef.current?.abort();
      currentRef.current = undefined;
      setDraft(undefined);
      setProgress(undefined);
      setGeneration((value) => value + 1);
    };
    window.addEventListener('lody:attachments-cleared', clear);
    return () => window.removeEventListener('lody:attachments-cleared', clear);
  }, [scope]);
  useEffect(() => {
    const controller = new AbortController();
    lifetimeRef.current = controller;
    currentRef.current = undefined;
    void loadAttachmentDraft(key)
      .then((value) => {
        if (controller.signal.aborted) return;
        const restored = value ?? newAttachmentDraft(key, scope);
        currentRef.current = restored;
        setDraft(restored);
        setError('');
        setProgress(undefined);
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => {
      controller.abort();
      transferRef.current?.abort();
    };
  }, [key, scope, generation]);
  const persist = async (value: AttachmentDraft, signal: AbortSignal) => {
    signal.throwIfAborted();
    const saved = await saveAttachmentDraft(value);
    signal.throwIfAborted();
    currentRef.current = saved;
    setDraft(saved);
    return saved;
  };
  const change = (update: (value: AttachmentDraft) => AttachmentDraft) => {
    const signal = lifetimeRef.current?.signal;
    const pending = queueRef.current.then(async () => {
      if (!signal || !currentRef.current || currentRef.current.key !== key)
        throw new Error('附件草稿尚未读取完成。');
      await persist(update(currentRef.current), signal);
    });
    queueRef.current = pending.catch(() => {});
    return pending;
  };
  return {
    items: draft?.key === key ? draft.items : [],
    loaded: draft?.key === key && !error,
    error,
    progress,
    add: (files: readonly File[]) => change((value) => appendDraftFiles(value, files)),
    remove: (id: string) =>
      change((value) => {
        const items = value.items.filter((item) => item.id !== id);
        return items.length
          ? { ...value, items }
          : { ...newAttachmentDraft(key, scope), revision: value.revision };
      }),
    clear: (ids: readonly string[]) =>
      change((value) => {
        const items = value.items.filter((item) => !ids.includes(item.id));
        return items.length
          ? { ...value, items }
          : { ...newAttachmentDraft(key, scope), revision: value.revision };
      }),
    cancel: () => transferRef.current?.abort(),
    async prepare(
      upload: (
        storageSessionId: string,
        file: File,
        options: AttachmentRequestOptions,
      ) => Promise<ReadyAttachment>,
      sessionId?: string,
    ) {
      await queueRef.current;
      const signal = lifetimeRef.current?.signal;
      let value = currentRef.current;
      if (!signal || !value || value.key !== key) throw new Error('附件草稿尚未读取完成。');
      signal.throwIfAborted();
      const controller = new AbortController();
      transferRef.current = controller;
      const combined = AbortSignal.any([signal, controller.signal]);
      try {
        // Persist the namespace before uploading; reload must reuse uploaded references.
        if (!value.revision) value = await persist(value, combined);
        for (const item of value.items) {
          if (item.ready) continue;
          setProgress({ id: item.id, percent: 0, phase: 'preparing' });
          const block = await upload(
            sessionId ?? value.storageSessionId,
            new File([item.source], item.name, {
              type: item.mimeType,
              lastModified: item.lastModified,
            }),
            {
              signal: combined,
              onProgress: (next) => {
                if (!combined.aborted)
                  setProgress({
                    id: item.id,
                    phase: next.phase,
                    percent: Math.round((next.loadedBytes / next.totalBytes) * 100),
                  });
              },
            },
          );
          value = await persist(
            {
              ...value,
              items: value.items.map((row) =>
                row.id === item.id ? { ...row, ready: block } : row,
              ),
            },
            combined,
          );
        }
        return {
          attachments: readyAttachments(value),
          reservedSessionId: value.storageSessionId,
          operationId: value.operationId,
        };
      } finally {
        if (!signal.aborted) setProgress(undefined);
        if (transferRef.current === controller) transferRef.current = undefined;
      }
    },
  };
}
