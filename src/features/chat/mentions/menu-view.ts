import type { ComposerMentionQuery } from './core';
import type { ComposerMentionKind, ComposerMentionSource } from './types';

export const mentionCategories: Record<
  ComposerMentionKind,
  {
    label: string;
    namespace: string;
    icon: 'terminal' | 'chat' | 'page' | 'agent';
    trigger?: string;
  }
> = {
  command: { label: '命令', namespace: 'cmd', icon: 'terminal', trigger: '/' },
  shortcut: { label: '快捷指令', namespace: 'shortcut', icon: 'agent', trigger: '/' },
  skill: { label: '技能', namespace: 'skill', icon: 'agent', trigger: '$' },
  session: { label: '会话', namespace: 'session', icon: 'chat' },
  tab: { label: '浏览器标签页', namespace: 'tab', icon: 'page' },
};

export interface ComposerMentionView {
  level: 'categories' | 'category' | 'aggregate';
  kinds: readonly ComposerMentionKind[];
  categories: readonly ComposerMentionKind[];
  category?: ComposerMentionKind;
  term: string;
  ranked: boolean;
  back: boolean;
}

// Port of selectMentionMenuViewForTrigger/selectMentionMenuView from Lody's registry.
export function selectComposerMentionView(
  query: ComposerMentionQuery,
  source: ComposerMentionSource,
): ComposerMentionView {
  const direct = query.trigger === '￥' ? '$' : query.trigger === '、' ? '/' : query.trigger;
  if (direct === '/') {
    return {
      level: 'aggregate',
      kinds: source.categories.filter((kind) => mentionCategories[kind].trigger === '/'),
      categories: [],
      term: query.search,
      ranked: Boolean(query.search.trim()),
      back: false,
    };
  }
  const colon = query.search.indexOf(':');
  const category = source.categories.find((kind) =>
    direct === '@'
      ? colon >= 0 && mentionCategories[kind].namespace === query.search.slice(0, colon)
      : mentionCategories[kind].trigger === direct,
  );
  if (category) {
    return {
      level: 'category',
      kinds: [category],
      categories: [],
      category,
      term: direct === '@' ? query.search.slice(colon + 1) : query.search,
      ranked: false,
      back: direct === '@',
    };
  }
  if (!query.search) {
    return {
      level: 'categories',
      kinds: [],
      categories: source.categories,
      term: '',
      ranked: false,
      back: false,
    };
  }
  const search = query.search.toLocaleLowerCase();
  return {
    level: 'aggregate',
    kinds: source.categories,
    categories: source.categories.filter(
      (kind) =>
        mentionCategories[kind].namespace.startsWith(search) ||
        mentionCategories[kind].label.toLocaleLowerCase().includes(search),
    ),
    term: query.search,
    ranked: false,
    back: false,
  };
}
