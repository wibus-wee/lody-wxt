import type { LoroDoc } from 'loro-crdt';
import { isContainer, LoroList, LoroMap, LoroText } from 'loro-crdt';
import type { LoroRepo, RepoRoomSubscription } from 'loro-repo';
import * as v from 'valibot';

import type { SessionHandle, SessionRepository } from '../application/runtime-ports.js';
import type { SendTurn, SessionMetadata, SessionSnapshot } from '../domain/runtime.js';
import { acquireWithin, bounded } from './lifecycle.js';
import {
  canonical,
  documentSchema,
  metadataSchema,
  permissionItemSchema,
  permissionOutcomeSchema,
  sendSchema,
} from './runtime-schemas.js';

export interface LoroSessionRepositoryOptions {
  repo: LoroRepo;
  metaRoom: RepoRoomSubscription;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Epoch milliseconds; supply a server-calibrated clock when available. */
  now?: () => number;
}

function mapValues(map: LoroMap, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (key === '$cid' || value === undefined) continue;
    // Arrays must be classified first: Valibot records also accept numeric array keys.
    if (Array.isArray(value)) {
      const list = map.setContainer(key, new LoroList());
      for (const item of value) {
        const entry = v.safeParse(v.record(v.string(), v.unknown()), item);
        if (entry.success)
          mapValues(list.insertContainer(list.length, new LoroMap()), entry.output);
        else
          list.insert(
            list.length,
            v.parse(v.union([v.string(), v.number(), v.boolean(), v.null()]), item),
          );
      }
    } else {
      const record = v.safeParse(v.record(v.string(), v.unknown()), value);
      if (record.success) mapValues(map.setContainer(key, new LoroMap()), record.output);
      else map.set(key, v.parse(v.union([v.string(), v.number(), v.boolean(), v.null()]), value));
    }
  }
}

// Loro's get() returns an opaque scalar-or-container union; its native guard validates this boundary.
// ast-grep-ignore: no-unknown-parameter
function decodeMapContainer(value: unknown): LoroMap {
  if (!isContainer(value) || value.kind() !== 'Map') throw new Error('invalid_history_container');
  return value as LoroMap;
}

// The document key is the session identity in Lody's metadata projection.
function readSessionMetadata(docId: string, metadata: Record<string, unknown>): SessionMetadata {
  const id = docId.slice('session-'.length);
  if (metadata.id !== undefined) {
    if (metadata.id !== id) throw new Error(`session_metadata_identity_conflict: ${docId}`);
  }
  const result = v.safeParse(metadataSchema, { ...metadata, id });
  if (!result.success) {
    const paths = result.issues.map((issue) => v.getDotPath(issue) ?? '(root)').join(', ');
    throw new Error(`session_metadata_invalid: ${docId} at ${paths}`, {
      cause: new v.ValiError(result.issues),
    });
  }
  return result.output;
}

export class LoroSessionRepository implements SessionRepository {
  private readonly rooms = new Map<string, { count: number; handle: SessionHandle }>();
  private readonly opening = new Map<string, Promise<SessionHandle>>();
  private readonly lifecycle = new AbortController();
  constructor(private readonly options: LoroSessionRepositoryOptions) {}

  private signal(): AbortSignal {
    return AbortSignal.any([
      this.lifecycle.signal,
      AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      ...(this.options.signal ? [this.options.signal] : []),
    ]);
  }

  list = async (): Promise<SessionMetadata[]> =>
    (await this.options.repo.listDoc())
      .filter(
        (row) =>
          row.docId.startsWith('session-') &&
          !row.docId.startsWith('session-comment-') &&
          !row.deleted,
      )
      .map((row) => readSessionMetadata(row.docId, row.meta));

  subscribe = (listener: () => void) => {
    const watch = this.options.repo.watch((event) => {
      // upsertDocMeta publishes existence before its metadata. Wait for the following metadata event.
      if (
        event.kind === 'doc-existence-changed' &&
        event.by === 'local' &&
        event.from === 'missing' &&
        event.to === 'active'
      )
        return;
      listener();
    });
    return () => watch.unsubscribe();
  };

  patch = async (sessionId: string, patch: Partial<SessionMetadata>) => {
    const parsed = v.parse(v.record(v.string(), v.unknown()), patch);
    await this.options.repo.upsertDocMeta(
      `session-${sessionId}`,
      JSON.parse(JSON.stringify(parsed)),
    );
    await this.options.repo.persistMetaNow();
    await bounded(this.options.metaRoom.waitUntilSynced(), this.signal());
  };

  create = async (meta: SessionMetadata) => {
    const parsed = v.parse(metadataSchema, meta);
    const existing = await this.options.repo.getDocMeta(`session-${parsed.id}`);
    if (existing) {
      const stored = readSessionMetadata(`session-${parsed.id}`, existing.meta);
      if (
        stored.id !== parsed.id ||
        stored.machineId !== parsed.machineId ||
        stored.userId !== parsed.userId ||
        stored.createdAt !== parsed.createdAt
      )
        throw new Error('session_conflict');
      await bounded(this.options.metaRoom.waitUntilSynced(), this.signal());
      return;
    }
    await this.patch(parsed.id, meta);
  };

  open = async (sessionId: string): Promise<SessionHandle> => {
    this.lifecycle.signal.throwIfAborted();
    let promise = this.opening.get(sessionId);
    if (!promise) {
      promise = this.load(sessionId);
      this.opening.set(sessionId, promise);
      void promise.catch(() => this.opening.delete(sessionId));
    }
    const handle = await promise;
    const room = this.rooms.get(sessionId);
    if (!room) throw new Error('Runtime closed');
    room.count++;
    let released = false;
    return {
      ...handle,
      close: async () => {
        if (released) return;
        released = true;
        room.count--;
        if (room.count === 0) {
          this.rooms.delete(sessionId);
          this.opening.delete(sessionId);
          await handle.close();
        }
      },
    };
  };

  private async load(sessionId: string): Promise<SessionHandle> {
    const roomId = `session-${sessionId}`;
    const signal = this.signal();
    const lease = await acquireWithin(this.options.repo.acquireDoc(roomId), signal, (resource) =>
      resource.release(),
    );
    const doc: LoroDoc = lease.doc;
    let room: RepoRoomSubscription;
    try {
      room = await acquireWithin(
        this.options.repo.joinDocRoom(roomId),
        signal,
        async (resource) => {
          resource.unsubscribe();
        },
      );
    } catch (error) {
      await lease.release();
      throw error;
    }
    try {
      await bounded(room.firstSyncedWithRemote, signal);
    } catch (error) {
      room.unsubscribe();
      await lease.release();
      throw error;
    }
    const read = (): SessionSnapshot => {
      const result = v.safeParse(documentSchema, doc.toJSON());
      if (!result.success) {
        const paths = result.issues.map((issue) => v.getDotPath(issue) ?? '(root)').join(', ');
        throw new Error(`session_document_invalid: ${roomId} at ${paths}`, {
          cause: new v.ValiError(result.issues),
        });
      }
      const parsed = result.output;
      return {
        sessionId,
        history: (parsed.history ?? []) as SessionSnapshot['history'],
        queue: (parsed.mq ?? []) as SessionSnapshot['queue'],
        session: parsed.session ?? {},
      };
    };
    let serial: Promise<void> = Promise.resolve();
    const write = (operation: () => Promise<void>) => {
      const next = serial.then(operation);
      serial = next.catch(() => {});
      return next;
    };
    const persist = async () => {
      doc.commit();
      await this.options.repo.persistDocNow(roomId, doc);
    };
    const append = (value: SendTurn, kind: 'dispatch' | 'queue' | 'guide') => {
      const input = v.parse(sendSchema, value);
      const blocks = input.inputConfig.inputBlocks ?? [
        { type: 'text' as const, text: input.inputConfig.prompt },
      ];
      if (!blocks.some((block) => block.type !== 'text' || block.text.trim()))
        throw new Error('empty_input');
      return write(async () => {
        const snapshot = read();
        const queued = snapshot.queue.find(
          (item) =>
            item.userTurnId === input.requestId || item.operationId === `queue:${input.requestId}`,
        );
        const existing = snapshot.history.find((turn) => turn.id === input.requestId);
        if (queued && kind !== 'queue') throw new Error('request_conflict');
        if (kind === 'queue') {
          const stored = queued ? queued.acpSessionConfig : existing?.inputConfig;
          const owner = queued ?? existing;
          if (
            owner &&
            (!stored ||
              Object.entries(input.inputConfig).some(
                ([key, value]) =>
                  canonical(stored[key as keyof typeof stored]) !== canonical(value),
              ) ||
              owner.userId !== input.userId ||
              owner.timestamp !== input.timestamp)
          )
            throw new Error('request_conflict');
          if (!owner) {
            const queue = doc.getMovableList('mq');
            const item = queue.insertContainer(queue.length, new LoroMap());
            mapValues(item, {
              task: input.inputConfig.prompt,
              userId: input.userId,
              userTurnId: input.requestId,
              operationId: `queue:${input.requestId}`,
              timestamp: input.timestamp,
            });
            mapValues(item.setContainer('acpSessionConfig', new LoroMap()), input.inputConfig);
          }
          await persist();
          await bounded(room.waitUntilSynced(), this.signal());
          // A promoted history entry owns delivery already; retry must not enqueue it again.
          if (!existing) {
            const meta = await this.options.repo.getDocMeta(roomId);
            const watermarks = v.parse(
              v.object({
                messageQueueUpdatedAt: v.exactOptional(v.number()),
                messageQueueCheckedAt: v.exactOptional(v.number()),
              }),
              meta?.meta ?? {},
            );
            await this.patch(sessionId, {
              messageQueueUpdatedAt: Math.max(
                (this.options.now ?? Date.now)(),
                (watermarks.messageQueueUpdatedAt ?? 0) + 1,
                (watermarks.messageQueueCheckedAt ?? 0) + 1,
              ),
            });
          }
          return;
        }
        if (existing) {
          if (
            canonical(existing.inputConfig) !== canonical(input.inputConfig) ||
            existing.userId !== input.userId ||
            existing.timestamp !== input.timestamp
          )
            throw new Error('request_conflict');
          await persist();
          await bounded(room.waitUntilSynced(), this.signal());
          if (kind === 'dispatch' && ['pending', 'seen'].includes(existing.status ?? 'pending'))
            await this.patch(sessionId, { latestUserMsgId: input.requestId });
          return;
        }
        const history = doc.getList('history');
        const turn = history.insertContainer(history.length, new LoroMap());
        mapValues(turn, {
          id: input.requestId,
          role: 'user',
          timestamp: input.timestamp,
          userId: input.userId,
          status: kind === 'guide' ? 'pending_apply' : 'pending',
          finished: true,
        });
        mapValues(turn.setContainer('inputConfig', new LoroMap()), input.inputConfig);
        const items = turn.setContainer('items', new LoroList());
        for (const block of blocks) {
          const item = items.insertContainer(items.length, new LoroMap());
          if (block.type === 'text') {
            item.set('type', 'text');
            item.setContainer('text', new LoroText()).update(block.text);
          } else mapValues(item, block);
        }
        turn.setContainer('fileDiff', new LoroList());
        await persist();
        await bounded(room.waitUntilSynced(), this.signal());
        if (kind === 'dispatch') await this.patch(sessionId, { latestUserMsgId: input.requestId });
      });
    };
    const permission: SessionHandle['respondPermission'] = (turnId, requestId, outcome) => {
      const parsedOutcome = v.parse(permissionOutcomeSchema, outcome);
      return write(async () => {
        const index = read().history.findIndex((turn) => turn.id === turnId);
        if (index < 0) throw new Error('turn_not_found');
        const turn = decodeMapContainer(doc.getList('history').get(index));
        const items = turn.get('items');
        if (!isContainer(items) || items.kind() !== 'List') throw new Error('permission_not_found');
        const list = items as LoroList;
        for (let i = 0; i < list.length; i++) {
          const item = decodeMapContainer(list.get(i));
          const parsed = v.safeParse(permissionItemSchema, item.toJSON());
          if (!parsed.success || parsed.output.permissionRequest.requestId !== requestId) continue;
          const request = decodeMapContainer(item.get('permissionRequest'));
          if (parsed.output.permissionRequest.outcome) {
            if (canonical(parsed.output.permissionRequest.outcome) !== canonical(parsedOutcome))
              throw new Error('permission_already_resolved');
            await persist();
            await bounded(room.waitUntilSynced(), this.signal());
            return;
          }
          if (
            parsedOutcome.outcome === 'selected' &&
            !parsed.output.permissionRequest.options.some(
              (option) => option.optionId === parsedOutcome.optionId,
            )
          )
            throw new Error('invalid_permission_option');
          mapValues(request.setContainer('outcome', new LoroMap()), parsedOutcome);
          await persist();
          await bounded(room.waitUntilSynced(), this.signal());
          return;
        }
        throw new Error('permission_not_found');
      });
    };
    const promote = (turnId: string) =>
      write(async () => {
        const index = read().history.findIndex(
          (turn) => turn.id === turnId && turn.role === 'user',
        );
        if (index < 0) throw new Error('turn_not_found');
        const turn = decodeMapContainer(doc.getList('history').get(index));
        if (turn.get('status') !== 'pending_apply') throw new Error('turn_not_pending_apply');
        turn.set('status', 'pending');
        await persist();
        await bounded(room.waitUntilSynced(), this.signal());
        await this.patch(sessionId, { latestUserMsgId: turnId });
      });
    const handle: SessionHandle = {
      read,
      subscribe: (listener, onError) =>
        doc.subscribe(() => {
          let snapshot: SessionSnapshot;
          try {
            snapshot = read();
          } catch (error) {
            if (!onError) throw error;
            if (!(error instanceof Error)) throw error;
            onError(error);
            return;
          }
          listener(snapshot);
        }),
      append,
      respondPermission: permission,
      promote,
      flush: async () => {
        await serial;
        await bounded(room.waitUntilSynced(), this.signal());
        await bounded(this.options.metaRoom.waitUntilSynced(), this.signal());
      },
      close: async () => {
        room.unsubscribe();
        await lease.release();
      },
    };
    this.rooms.set(sessionId, { count: 0, handle });
    return handle;
  }

  close = async () => {
    this.lifecycle.abort(new Error('Runtime closed'));
    await Promise.allSettled(this.opening.values());
    await Promise.all(Array.from(this.rooms.values(), (room) => room.handle.close()));
    this.rooms.clear();
    this.opening.clear();
  };
}
