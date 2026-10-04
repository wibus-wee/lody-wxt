import type { LoroRepo } from 'loro-repo';
import * as v from 'valibot';

import { acquireWithin, bounded } from '../../shared/infrastructure/lifecycle.js';
import type { WorkspaceMcpServer } from '../domain/mcp.js';

const id = v.pipe(v.string(), v.trim(), v.minLength(1));
const strings = v.record(v.string(), v.string());
const connection = v.variant('transport', [
  v.object({
    transport: v.literal('stdio'),
    command: v.string(),
    args: v.exactOptional(v.array(v.string())),
    env: v.exactOptional(strings),
    envPassthrough: v.exactOptional(v.array(v.pipe(v.string(), v.regex(/^[A-Z_]\w*$/i)))),
  }),
  v.object({
    transport: v.literal('http'),
    url: v.string(),
    bearerToken: v.exactOptional(v.string()),
    headers: v.exactOptional(strings),
  }),
]);
const meta = v.object({
  id,
  name: id,
  transport: v.picklist(['stdio', 'http']),
  description: v.exactOptional(v.string()),
  connection: v.exactOptional(connection),
  enabledByDefault: v.exactOptional(v.boolean()),
  createdAt: v.pipe(v.number(), v.finite()),
  updatedAt: v.pipe(v.number(), v.finite()),
  createdBy: v.exactOptional(v.string()),
});
const row = v.object({
  key: v.array(v.union([v.string(), v.number()])),
  value: v.exactOptional(v.unknown()),
});

export class WorkspaceMcpCatalog {
  constructor(
    private readonly options: {
      repo: LoroRepo;
      workspaceId: string;
      signal?: AbortSignal;
      timeoutMs?: number;
    },
  ) {}
  list = async (): Promise<WorkspaceMcpServer[]> => {
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      ...(this.options.signal ? [this.options.signal] : []),
    ]);
    const docId = `${this.options.workspaceId}:wf:workspace`;
    const lease = await acquireWithin(
      this.options.repo.acquireFlockDoc(docId),
      signal,
      (resource) => resource.release(),
    );
    let room;
    try {
      room = await acquireWithin(
        this.options.repo.joinFlockDocRoom(docId),
        signal,
        async (resource) => {
          resource.unsubscribe();
        },
      );
      await bounded(room.firstSyncedWithRemote, signal);
      const result: WorkspaceMcpServer[] = [];
      for (const raw of lease.flock.scanValues()) {
        const entry = v.parse(row, raw);
        if (entry.key[0] !== 'mcpServer' || entry.value === undefined) continue;
        const key = v.parse(v.tuple([v.literal('mcpServer'), id]), entry.key);
        const server = v.parse(meta, entry.value);
        if (
          server.id !== key[1] ||
          (server.connection && server.connection.transport !== server.transport)
        )
          throw new Error('MCP catalog identity or transport mismatch');
        result.push({
          id: server.id,
          name: server.name,
          transport: server.transport,
          ...(server.description === undefined ? {} : { description: server.description }),
          enabledByDefault: server.enabledByDefault === true,
          hasConnection: server.connection !== undefined,
        });
      }
      return result;
    } finally {
      room?.unsubscribe();
      await lease.release();
    }
  };
}
