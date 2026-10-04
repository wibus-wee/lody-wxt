import type { DataChange, DataKind } from '../domain/models.js';

export type DataRead = { kind: DataKind; value: unknown; version: string; revision: number };
export type DataExport = { bytes: string; version: string };
export type DataEnvironment = { readonly origin: string | null; readonly userAgent: string | null };

/** Binary fields are canonical base64. The optional AbortSignal stays local. */
export interface DataMethods {
  open: (input: { documentId: string; kind: DataKind }, signal?: AbortSignal) => Promise<null>;
  import: (input: { documentId: string; bytes: string }, signal?: AbortSignal) => Promise<null>;
  read: (input: { documentId: string }, signal?: AbortSignal) => Promise<DataRead>;
  export: (
    input: { documentId: string; from?: string },
    signal?: AbortSignal,
  ) => Promise<DataExport>;
}

/** Owns one isolated engine. Closure releases event callbacks and disposal is idempotent. */
export interface DocumentSession {
  readonly instanceId: string;
  readonly ready: Promise<DataEnvironment>;
  readonly data: DataMethods;
  readonly closed: boolean;
  /** True after the host handshake and before closure; checked synchronously by subscriptions. */
  readonly available: boolean;
  onChange: (listener: (change: DataChange) => void) => () => void;
  onClose: (listener: () => void) => () => void;
  dispose: () => void;
}
