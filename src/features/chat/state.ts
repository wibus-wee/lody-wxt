import { atom, useAtom } from 'jotai';
import { useEffect, useState } from 'react';

import { readLocal, writeLocal } from '../../shared/storage';
import type { RunConfig } from '../connection/run-config';
import { parseRunConfig } from '../connection/run-config';
import type { PageContext } from '../page-context/model';
import { parseContexts, record } from './validation';

interface Draft {
  text: string;
  contexts: PageContext[];
  operationId: string;
  submittedText: string;
  inputConfig?: RunConfig | undefined;
}
interface ChatUI {
  selected: Record<string, string>;
  drafts: Record<string, Draft>;
}
const empty: ChatUI = { selected: {}, drafts: {} };
const uiAtom = atom<ChatUI>(empty);
const loadedAtom = atom(false);
const emptyDraft: Draft = { text: '', contexts: [], operationId: '', submittedText: '' };
let writes = Promise.resolve();

function parseUI(value: unknown): ChatUI {
  const stored = record(value);
  const selected = Object.fromEntries(
    Object.entries(record(stored?.selected) ?? {}).filter(
      ([key, id]) => key.length <= 300 && typeof id === 'string' && id.length <= 200,
    ),
  );
  const drafts: Record<string, Draft> = {};
  for (const [key, value] of Object.entries(record(stored?.drafts) ?? {}).slice(0, 200)) {
    const draft = record(value);
    if (
      key.length > 600 ||
      !draft ||
      typeof draft.text !== 'string' ||
      typeof draft.operationId !== 'string' ||
      typeof draft.submittedText !== 'string'
    )
      continue;
    drafts[key] = {
      text: draft.text.slice(0, 16000),
      operationId: draft.operationId.slice(0, 200),
      submittedText: draft.submittedText.slice(0, 16000),
      contexts: parseContexts(draft.contexts),
      inputConfig: parseRunConfig(draft.inputConfig),
    };
  }
  return { selected: selected as Record<string, string>, drafts };
}

export function useChatUI(accountKey: string) {
  const [ui, setUI] = useAtom(uiAtom);
  const [loaded, setLoaded] = useAtom(loadedAtom);
  const [storageError, setStorageError] = useState('');
  useEffect(() => {
    let alive = true;
    if (!loaded)
      void readLocal<unknown>('chat-ui:v1', empty)
        .then((stored) => {
          if (alive) {
            setUI(parseUI(stored));
            setLoaded(true);
          }
        })
        .catch(() => {
          if (alive) {
            setStorageError('无法恢复草稿。请重试打开侧栏。');
            setLoaded(true);
          }
        });
    return () => {
      alive = false;
    };
  }, [loaded, setLoaded, setUI]);
  const update = (transform: (value: ChatUI) => ChatUI) => {
    setUI((value) => {
      const next = transform(value);
      writes = writes.catch(() => {}).then(() => writeLocal('chat-ui:v1', next));
      void writes.then(
        () => setStorageError(''),
        () => setStorageError('草稿未保存：检查存储空间。当前文本仍保留。'),
      );
      return next;
    });
  };
  const selected = ui.selected[accountKey] ?? '';
  const draftKey = `${accountKey}:${selected || 'new'}`;
  const draft = ui.drafts[draftKey] ?? emptyDraft;
  return {
    loaded,
    selected,
    draft,
    storageError,
    select: (id: string) =>
      update((value) => ({ ...value, selected: { ...value.selected, [accountKey]: id } })),
    edit: (patch: Partial<Draft>, sessionId?: string) =>
      update((value) => {
        const key = sessionId ? `${accountKey}:${sessionId}` : draftKey;
        return {
          ...value,
          drafts: { ...value.drafts, [key]: { ...(value.drafts[key] ?? draft), ...patch } },
        };
      }),
  };
}
