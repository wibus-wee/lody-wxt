import type { KeyboardEvent, RefObject } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { rankMentionCandidates } from '../../../shared/ui/mention-scoring';
import type { PageContext } from '../../connection/client';
import { rankSlashItems } from './command-slash-search';
import type { MentionMenuRow } from './ComposerMentionMenu';
import type { ComposerMentionQuery } from './core';
import { COMPOSER_MAX_LENGTH, mentionQuery } from './core';
import { mentionCategories, selectComposerMentionView } from './menu-view';
import {
  findAdjacentMentionForHorizontalNavigation,
  findMentionBeforeCursorForDeletion,
  removeMentionText,
} from './range-navigation';
import type {
  ComposerMentionItem,
  ComposerMentionKind,
  ComposerMentionRange,
  ComposerMentionSource,
} from './types';

const bareNamespace = /^[a-z]+:$/u;
const separator = /^[ \n]/u;

export function useComposerMentions({
  source,
  value,
  disabled,
  inputRef,
  onCommit,
  ranges = [],
}: {
  source: ComposerMentionSource | undefined;
  ranges?: readonly ComposerMentionRange[] | undefined;
  value: string;
  disabled: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onCommit: (text: string, ranges?: readonly ComposerMentionRange[], context?: PageContext) => void;
}) {
  const [query, setQuery] = useState<ComposerMentionQuery | null>(null);
  const [rows, setRows] = useState<MentionMenuRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const preparationRef = useRef<AbortController | null>(null);
  const preparationInputRef = useRef<{ value: string; start: number; end: number } | null>(null);
  const cacheRef = useRef(new Map<ComposerMentionKind, Promise<ComposerMentionItem[]>>());
  const loadControllerRef = useRef(new AbortController());
  const dismissedRef = useRef<string | null>(null);
  const sourceScope = source?.scopeKey;
  const open = Boolean(query) && !disabled;
  const listId = useId();
  const view = query && source ? selectComposerMentionView(query, source) : null;
  const scrollHighlightRef = useRef(false);
  useEffect(() => {
    preparationRef.current?.abort();
    if (dismissedRef.current !== value) dismissedRef.current = null;
    queueMicrotask(() => setPreparing(false));
  }, [value]);
  const close = () => {
    preparationRef.current?.abort();
    loadControllerRef.current.abort();
    loadControllerRef.current = new AbortController();
    cacheRef.current.clear();
    dismissedRef.current = inputRef.current?.value ?? null;
    setQuery(null);
    setPreparing(false);
  };
  const inspect = (input: HTMLTextAreaElement, force = false) => {
    const pending = preparationInputRef.current;
    if (preparationRef.current && !preparationRef.current.signal.aborted && pending) {
      if (
        pending.value === input.value &&
        pending.start === input.selectionStart &&
        pending.end === input.selectionEnd
      )
        return;
      preparationRef.current.abort();
      setPreparing(false);
    }
    if (input.selectionStart === input.selectionEnd) {
      const inside = ranges.find(
        (range) =>
          range.start < input.selectionStart &&
          range.end > input.selectionStart &&
          input.value.slice(range.start, range.end) === range.text,
      );
      if (inside) {
        const caret =
          input.selectionStart - inside.start <= inside.end - input.selectionStart
            ? inside.start
            : inside.end;
        input.setSelectionRange(caret, caret);
      }
    }
    // Atomic range selection is independent of whether this text's menu was dismissed.
    if (!source || disabled || (!force && dismissedRef.current === input.value)) return;
    if (dismissedRef.current !== input.value) dismissedRef.current = null;
    const detected = mentionQuery(input.value, input.selectionStart, input.selectionEnd);
    const next =
      detected &&
      !ranges.some(
        (range) =>
          range.start <= detected.start &&
          range.end >= detected.end &&
          input.value.slice(range.start, range.end) === range.text,
      )
        ? detected
        : null;
    if (!next && query) {
      close();
      dismissedRef.current = null;
      return;
    }
    setQuery((current) =>
      current?.start === next?.start &&
      current?.end === next?.end &&
      current?.search === next?.search &&
      current?.trigger === next?.trigger
        ? current
        : next,
    );
  };
  useEffect(() => {
    preparationRef.current?.abort();
    loadControllerRef.current.abort();
    loadControllerRef.current = new AbortController();
    cacheRef.current.clear();
    queueMicrotask(() => {
      setQuery(null);
      setPreparing(false);
    });
    return () => {
      preparationRef.current?.abort();
      loadControllerRef.current.abort();
    };
  }, [sourceScope, disabled]);
  useEffect(() => {
    if (!open) return;
    return source?.subscribe?.(() => {
      preparationRef.current?.abort();
      loadControllerRef.current.abort();
      loadControllerRef.current = new AbortController();
      cacheRef.current.clear();
      setPreparing(false);
      setRevision((current) => current + 1);
    });
  }, [source, open]);
  useEffect(() => {
    if (!query || !source) return;
    const controller = new AbortController();
    const currentView = selectComposerMentionView(query, source);
    const { kinds, term } = currentView;
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setSelected(0);
      setError('');
      if (currentView.level === 'categories') {
        setRows(
          currentView.categories.map((category) => ({ type: 'category', id: category, category })),
        );
        setLoading(false);
        return;
      }
      setRows([]);
      setLoading(true);
      const results = await Promise.allSettled(
        kinds.map((kind) => {
          const cached = cacheRef.current.get(kind);
          if (cached) return cached;
          const pending = source.load(kind, loadControllerRef.current.signal);
          cacheRef.current.set(kind, pending);
          return pending;
        }),
      );
      if (controller.signal.aborted) return;
      const errors: string[] = [];
      const items = results.flatMap((result) => {
        if (result.status === 'fulfilled') return result.value;
        errors.push(result.reason instanceof Error ? result.reason.message : '无法读取提及来源。');
        return [];
      });
      const search = term.toLocaleLowerCase();
      const rank = (candidates: ComposerMentionItem[]) =>
        rankSlashItems(
          candidates.filter(
            (item) =>
              !item.disabledReason ||
              item.kind !== 'shortcut' ||
              (item.exactMatchTerms ?? [item.label]).some(
                (term) => term.toLocaleLowerCase() === search,
              ),
          ),
          search,
          (item) => ({
            token: item.label,
            ...(item.keywords ? { name: item.keywords } : {}),
            ...(item.description ? { description: item.description } : {}),
          }),
        )
          .map(({ item }) => item)
          .sort(
            (left, right) =>
              Number(Boolean(left.disabledReason)) - Number(Boolean(right.disabledReason)),
          );
      const matches = currentView.ranked
        ? rank(items).slice(0, 80)
        : kinds.flatMap((kind) =>
            (new Set(['command', 'shortcut']).has(kind)
              ? rank(items.filter((item) => item.kind === kind))
              : rankMentionCandidates(
                  items.filter((item) => item.kind === kind),
                  term,
                  {
                    limit: 80,
                    fields: (item) => [item.label, item.keywords ?? '', item.description ?? ''],
                  },
                )
            ).slice(0, currentView.level === 'aggregate' && query.trigger === '@' ? 8 : 80),
          );
      const nextRows: MentionMenuRow[] = [
        ...currentView.categories.map((category) => ({
          type: 'category' as const,
          id: category,
          category,
        })),
        ...matches.map((item) => ({ type: 'item' as const, id: `${item.kind}:${item.id}`, item })),
      ];
      setRows(nextRows);
      setSelected(nextRows.findIndex((row) => row.type === 'category' || !row.item.disabledReason));
      scrollHighlightRef.current = true;
      setError(errors.join('\n'));
      setLoading(false);
    });
    return () => controller.abort();
  }, [query, source, revision]);
  useEffect(() => {
    if (query && scrollHighlightRef.current) {
      document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: 'nearest' });
      scrollHighlightRef.current = false;
    }
  }, [listId, query, selected]);
  const replace = (
    text: string,
    expansion?: string,
    navigate = false,
    ranges: readonly ComposerMentionRange[] = [],
    context?: PageContext,
  ) => {
    const input = inputRef.current;
    if (!input || !query) return;
    const suffix = navigate || !text || separator.test(input.value.slice(query.end)) ? '' : ' ';
    const result = input.value.slice(0, query.start) + text + suffix + input.value.slice(query.end);
    if (result.length > COMPOSER_MAX_LENGTH) {
      setError('加入后超过消息长度上限，请先缩短草稿。');
      return;
    }
    onCommit(
      result,
      [...(expansion ? [{ start: 0, end: text.length, text, expansion }] : []), ...ranges].map(
        (range) => ({
          ...range,
          start: range.start + query.start,
          end: range.end + query.start,
          ...(sourceScope ? { scope: sourceScope } : {}),
        }),
      ),
      context,
    );
    if (!navigate) close();
    queueMicrotask(() => {
      input.focus({ preventScroll: true });
      input.setSelectionRange(
        query.start + text.length + suffix.length,
        query.start + text.length + suffix.length,
      );
      if (navigate) {
        dismissedRef.current = null;
        setQuery({ ...query, end: query.start + text.length, search: text.slice(1) });
      }
    });
  };
  const select = (row: MentionMenuRow) => {
    if (row.type === 'category') {
      replace(`@${mentionCategories[row.category].namespace}:`, undefined, true);
      return;
    }
    if (row.item.disabledReason || preparing) return;
    setRetrying(false);
    const input = inputRef.current;
    if (!input || !query) return;
    const captured = input.value;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    preparationInputRef.current = { value: captured, start, end };
    const controller = new AbortController();
    preparationRef.current?.abort();
    preparationRef.current = controller;
    setPreparing(true);
    setError('');
    void row.item
      .prepare(controller.signal)
      .then((prepared) => {
        if (
          !controller.signal.aborted &&
          input.value === captured &&
          input.selectionStart === start &&
          input.selectionEnd === end
        )
          replace(prepared.text, prepared.expansion, false, prepared.ranges, prepared.context);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : '无法插入此项目。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreparing(false);
      });
  };
  const back = () => {
    if (query?.trigger !== '@') return;
    replace('@', undefined, true);
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return false;
    const input = event.currentTarget;
    const cursor = input.selectionStart;
    const hasSelection = cursor !== input.selectionEnd;
    const modified = event.metaKey || event.ctrlKey;
    // Lody's range navigation runs before its menu navigation.
    if (new Set(['ArrowLeft', 'ArrowRight']).has(event.key) && !hasSelection && !event.shiftKey) {
      const left = event.key === 'ArrowLeft';
      const adjacent = findAdjacentMentionForHorizontalNavigation({
        mentions: ranges,
        value: input.value,
        cursorPosition: cursor,
        direction: left ? 'left' : 'right',
        isWordJump: modified,
      });
      if (adjacent) {
        event.preventDefault();
        const caret = modified
          ? left
            ? adjacent.start
            : adjacent.end
          : left
            ? cursor > adjacent.end
              ? adjacent.end
              : adjacent.start
            : cursor < adjacent.start
              ? adjacent.start
              : adjacent.end;
        input.setSelectionRange(caret, caret);
        return true;
      }
      if (modified) return false;
    }
    if (event.key === 'Backspace' && !open && !hasSelection) {
      const mention = findMentionBeforeCursorForDeletion({
        mentions: ranges,
        value: input.value,
        cursorPosition: cursor,
        isCtrlOrCmd: modified,
      });
      if (mention) {
        event.preventDefault();
        const trailing = input.value[mention.end] === ' ';
        const onlySpace = trailing && cursor === mention.end + 1 && !modified;
        const next = onlySpace
          ? input.value.slice(0, mention.end) + input.value.slice(mention.end + 1)
          : removeMentionText(input.value, mention, trailing);
        const caret = onlySpace ? mention.end : mention.start;
        onCommit(next);
        queueMicrotask(() => input.setSelectionRange(caret, caret));
        return true;
      }
    }
    if (!query) return false;
    if (event.key === 'Enter' && (modified || event.shiftKey)) return false;
    const enabled = rows.flatMap((row, index) =>
      row.type === 'category' || !row.item.disabledReason ? [index] : [],
    );
    const move = (index: number) => {
      preparationRef.current?.abort();
      setPreparing(false);
      scrollHighlightRef.current = true;
      setSelected(enabled[Math.max(0, Math.min(enabled.length - 1, index))] ?? -1);
    };
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        return true;
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const current = enabled.indexOf(selected);
        move(
          current < 0
            ? event.key === 'ArrowDown'
              ? 0
              : enabled.length - 1
            : current + (event.key === 'ArrowDown' ? 1 : -1),
        );
        return true;
      }
      case 'Home':
      case 'End':
        if (modified) return false;
        event.preventDefault();
        move(event.key === 'Home' ? 0 : enabled.length - 1);
        return true;
      case 'ArrowLeft':
      case 'Backspace':
        if (
          !hasSelection &&
          !event.shiftKey &&
          query.trigger === '@' &&
          bareNamespace.test(query.search)
        ) {
          event.preventDefault();
          back();
          return true;
        }
        return false;
      case 'ArrowRight':
        if (hasSelection || event.shiftKey || rows[selected]?.type !== 'category') return false;
        break;
      case 'Tab':
        if (event.shiftKey) {
          close();
          return false;
        }
        break;
      case 'Enter':
        break;
      default:
        return false;
    }
    const row = rows[selected];
    if (!row && !loading && !preparing) {
      close();
      // Original Enter closes an empty menu without accidentally sending the draft.
      if (event.key === 'Enter') {
        event.preventDefault();
        return true;
      }
      return false;
    }
    event.preventDefault();
    if (row && !loading && !preparing) select(row);
    return true;
  };
  return {
    open,
    query,
    view,
    back,
    rows,
    selected,
    setSelected: (index: number) => {
      scrollHighlightRef.current = false;
      setSelected(index);
    },
    loading,
    preparing,
    retrying,
    error,
    listId,
    close,
    inspect,
    select,
    keyDown,
    retry: () => {
      if (!source || !view || preparing) return;
      const input = inputRef.current;
      if (!input) return;
      const controller = new AbortController();
      preparationRef.current?.abort();
      preparationRef.current = controller;
      preparationInputRef.current = {
        value: input.value,
        start: input.selectionStart,
        end: input.selectionEnd,
      };
      setPreparing(true);
      setRetrying(true);
      setError('');
      void Promise.all(view.kinds.map((kind) => source.retry?.(kind, controller.signal)))
        .then(() => {
          if (controller.signal.aborted) return;
          cacheRef.current.clear();
          setRevision((current) => current + 1);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : '无法重新读取来源。');
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreparing(false);
        });
    },
  };
}
