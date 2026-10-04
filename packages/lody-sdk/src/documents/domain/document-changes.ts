import type { DataChange } from './models.js';

export type ChangeListener = (change: DataChange) => void;

/** A document publishes each increasing engine revision once, without an initial replay. */
export class DocumentChanges {
  private readonly listeners = new Map<string, Set<ChangeListener>>();
  private readonly revisions = new Map<string, number>();

  subscribe(documentId: string, listener: ChangeListener): () => void {
    const set = this.listeners.get(documentId) ?? new Set<ChangeListener>();
    set.add(listener);
    this.listeners.set(documentId, set);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      set.delete(listener);
      if (!set.size && this.listeners.get(documentId) === set) this.listeners.delete(documentId);
    };
  }

  publish(change: DataChange): void {
    const { documentId, revision } = change;
    if (revision <= (this.revisions.get(documentId) ?? 0)) return;
    this.revisions.set(documentId, revision);
    for (const listener of [...(this.listeners.get(documentId) ?? [])]) {
      if (!this.listeners.get(documentId)?.has(listener)) continue;
      try {
        listener({ documentId, revision });
      } catch {
        // One consumer cannot interrupt sibling subscriptions.
      }
    }
  }

  clear(): void {
    this.listeners.clear();
    this.revisions.clear();
  }
}
