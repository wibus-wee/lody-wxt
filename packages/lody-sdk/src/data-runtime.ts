import { OfflineDocumentService } from './documents/application/offline-document-service.js';
import type { DataRuntimeOptions } from './documents/infrastructure/birpc-document-session.js';
import { BirpcDocumentSession } from './documents/infrastructure/birpc-document-session.js';
import type { DataHost } from './documents/infrastructure/host.js';

/** Composes an isolated bridge adapter with the offline document application's use cases. */
export class OfflineDataRuntime extends OfflineDocumentService {
  constructor(host: DataHost, options: DataRuntimeOptions = {}) {
    super(new BirpcDocumentSession(host, options));
  }
}

export type {
  DataEnvironment,
  DataExport,
  DataMethods,
  DataRead,
} from './documents/application/ports.js';
export type { DataChange, DataKind } from './documents/domain/models.js';
export type { DataRuntimeOptions } from './documents/infrastructure/birpc-document-session.js';
export type { DataHost } from './documents/infrastructure/host.js';
