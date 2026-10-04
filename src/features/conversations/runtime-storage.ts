import type { LoroRuntimeOptions } from '@lody-mobile/sdk/loro';
import * as v from 'valibot';

type CursorStore = LoroRuntimeOptions['documentRemoteCursorStore'];
type Cursor = Parameters<CursorStore['save']>[0];
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonSchema: v.GenericSchema<JsonValue> = v.lazy(() =>
  v.union([
    v.string(),
    v.number(),
    v.boolean(),
    v.null(),
    v.array(jsonSchema),
    v.record(v.string(), jsonSchema),
  ]),
);
const cursorSchema = v.object({
  streamUrl: v.string(),
  nextOffset: v.string(),
  updatedAtMs: v.number(),
  serverLowerBoundVersion: v.record(v.string(), jsonSchema),
});

export function createDocumentCursorStore(scope: string): CursorStore {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`lody:document-cursors:${scope}`, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('cursors', { keyPath: 'streamUrl' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transact = async (
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest,
  ): Promise<unknown> => {
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('cursors', mode, { durability: 'strict' });
      const request = action(transaction.objectStore('cursors'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  };
  return {
    async load(streamUrl) {
      const result = await transact('readonly', (store) => store.get(streamUrl));
      if (result === undefined) return null;
      return v.parse(cursorSchema, result);
    },
    async save(cursor: Cursor) {
      await transact('readwrite', (store) => store.put(v.parse(cursorSchema, cursor)));
    },
    async delete(streamUrl) {
      await transact('readwrite', (store) => store.delete(streamUrl));
    },
  };
}
