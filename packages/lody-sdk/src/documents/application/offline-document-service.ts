import type { ChangeListener } from '../domain/document-changes.js';
import { DocumentChanges } from '../domain/document-changes.js';
import { validDocumentId } from '../domain/document-id.js';
import type { DataEnvironment, DataMethods, DocumentSession } from './ports.js';

export class OfflineDocumentService {
  readonly instanceId: string;
  readonly ready: Promise<DataEnvironment>;
  readonly data: DataMethods;
  private readonly changes = new DocumentChanges();

  constructor(private readonly session: DocumentSession) {
    this.instanceId = session.instanceId;
    this.ready = session.ready;
    this.data = session.data;
    session.onChange((change) => this.changes.publish(change));
    session.onClose(() => this.changes.clear());
  }

  get closed(): boolean {
    return this.session.closed;
  }

  subscribe(documentId: string, listener: ChangeListener): () => void {
    if (!validDocumentId(documentId)) throw new Error('invalid_input');
    if (!this.session.available) throw new Error('not_ready');
    return this.changes.subscribe(documentId, listener);
  }

  dispose(): void {
    this.session.dispose();
  }
}
