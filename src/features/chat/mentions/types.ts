import type { PageContext } from '../../connection/client';

export type ComposerMentionKind = 'command' | 'shortcut' | 'skill' | 'session' | 'tab';

export interface PreparedComposerMention {
  text: string;
  expansion?: string;
  ranges?: readonly ComposerMentionRange[];
  context?: PageContext;
}

export interface ComposerMentionItem {
  id: string;
  kind: ComposerMentionKind;
  label: string;
  description?: string;
  keywords?: string;
  disabledReason?: string;
  iconEmoji?: string;
  exactMatchTerms?: readonly string[];
  detail?: {
    title?: string;
    meta?: readonly string[];
    description?: string | undefined;
    rows?: readonly { label: string; value: string }[];
  };
  prepare: (signal: AbortSignal) => Promise<PreparedComposerMention>;
}

export interface ComposerMentionSource {
  scopeKey: string;
  categories: readonly ComposerMentionKind[];
  load: (kind: ComposerMentionKind, signal: AbortSignal) => Promise<ComposerMentionItem[]>;
  retry?: (kind: ComposerMentionKind, signal: AbortSignal) => Promise<void>;
  subscribe?: (listener: () => void) => () => void;
}

export interface ComposerMentionRange {
  start: number;
  end: number;
  text: string;
  expansion: string;
  scope?: string;
}
