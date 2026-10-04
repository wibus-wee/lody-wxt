import * as v from 'valibot';

import type { ScheduleRepository } from '../application/ports.js';
import type {
  ScheduleDocument,
  ScheduleEnable,
  ScheduleRunRequest,
  ScheduleSave,
} from '../domain/models.js';
import { buildScheduleRegistryRow, canonicalScheduleJson } from './registry.js';
import {
  activitySchema,
  definitionSchema,
  documentSchema,
  manualSchema,
  registrySchema,
  runtimeSchema,
  scheduleIdSchema,
  tombstoneSchema,
} from './schemas.js';

export type ScheduleRegistryValue =
  | v.InferOutput<typeof registrySchema>
  | v.InferOutput<typeof manualSchema>
  | v.InferOutput<typeof tombstoneSchema>;

export interface ScheduleStorage {
  scan: () => Promise<Array<{ key: readonly unknown[]; value?: unknown }>>;
  readDocument: (scheduleId: string) => Promise<unknown | null>;
  writeDocument: (document: ScheduleDocument) => Promise<void>;
  writeRegistry: (key: string[], value: ScheduleRegistryValue) => Promise<void>;
}

export class ProtocolScheduleRepository implements ScheduleRepository {
  constructor(private readonly storage: ScheduleStorage) {}
  list = async () => {
    const rows = await this.storage.scan();
    const deleted = new Set(
      rows
        .filter((row) => row.key[0] === 'tombstone' && v.is(tombstoneSchema, row.value))
        .map((row) => row.key[1]),
    );
    return rows
      .filter(
        (row) => row.key[0] === 'schedule' && row.key.length === 2 && !deleted.has(row.key[1]),
      )
      .map((row) => {
        const value = v.parse(registrySchema, row.value);
        if (value.scheduleId !== row.key[1]) throw new Error('Schedule registry identity mismatch');
        return value;
      });
  };
  runtimeRows = async () =>
    (await this.storage.scan())
      .filter((row) => row.key[0] === 'runtime' && row.key.length === 3)
      .map((row) => {
        const value = v.parse(runtimeSchema, row.value);
        if (value.scheduleId !== row.key[1] || value.machineId !== row.key[2])
          throw new Error('Schedule runtime identity mismatch');
        return value;
      });
  read = async (scheduleId: string) => {
    v.parse(scheduleIdSchema, scheduleId);
    const raw = await this.storage.readDocument(scheduleId);
    if (raw === null) return null;
    const document = v.parse(documentSchema, raw);
    if (document.definition.scheduleId !== scheduleId)
      throw new Error('Schedule document identity mismatch');
    return document;
  };
  private async write(document: ScheduleDocument) {
    const validated = v.parse(documentSchema, document);
    const row = await buildScheduleRegistryRow(validated);
    await this.storage.writeDocument(validated);
    const deleted = (await this.storage.scan()).find(
      (entry) => entry.key[0] === 'tombstone' && entry.key[1] === row.scheduleId,
    );
    if (deleted && v.is(tombstoneSchema, deleted.value)) throw new Error('Schedule was deleted');
    await this.storage.writeRegistry(['schedule', row.scheduleId], row);
  }
  private async owned(scheduleId: string, actorId: string) {
    const row = (await this.list()).find((entry) => entry.scheduleId === scheduleId);
    const document = await this.read(scheduleId);
    if (!row || !document) throw new Error('Schedule not found');
    if (row.ownerId !== actorId || document.definition.ownerId !== actorId)
      throw new Error('Only the Schedule owner can change it');
    return document;
  }
  save = async (args: ScheduleSave) => {
    const previous = args.create
      ? await this.read(args.scheduleId)
      : await this.owned(args.scheduleId, args.actorId);
    const incoming = {
      ...args.draft,
      destination: args.draft.destination ?? { kind: 'new_session' as const },
    };
    const prior = previous?.timeline.find((entry) => entry.id === args.activityId);
    if (prior && previous) {
      const {
        title,
        machineId,
        trigger,
        misfirePolicy,
        overlapPolicy,
        agent,
        project,
        destination,
        retryPolicy,
      } = previous.definition;
      const draft = {
        title,
        machineId,
        trigger,
        misfirePolicy,
        overlapPolicy,
        agent,
        project,
        destination,
        retryPolicy,
        prompt: previous.prompt,
      };
      if (
        prior.actorId !== args.actorId ||
        previous.definition.ownerId !== args.actorId ||
        prior.kind !== (args.create ? 'created' : 'edited') ||
        canonicalScheduleJson(draft) !== canonicalScheduleJson(incoming)
      )
        throw new Error('Idempotency key conflict');
      await this.write(previous);
      return previous;
    }
    if (args.create && previous) throw new Error('Schedule id already exists');
    const { prompt, ...draft } = incoming;
    const definition = v.parse(definitionSchema, {
      ...draft,
      scheduleId: args.scheduleId,
      ownerId: args.actorId,
      enabled: previous?.definition.enabled ?? true,
      activationId: args.activationId,
      activeFrom: args.now,
      createdAt: previous?.definition.createdAt ?? args.now,
      createdBy: previous?.definition.createdBy ?? args.actorId,
      updatedAt: args.now,
    });
    const activity = v.parse(activitySchema, {
      id: args.activityId,
      kind: previous ? 'edited' : 'created',
      actorId: args.actorId,
      createdAt: args.now,
    });
    const document = { definition, prompt, timeline: [...(previous?.timeline ?? []), activity] };
    await this.write(document);
    return document;
  };
  setEnabled = async (args: ScheduleEnable) => {
    const document = await this.owned(args.scheduleId, args.actorId);
    const prior = document.timeline.find((entry) => entry.id === args.requestId);
    const kind = args.enabled ? 'resumed' : 'paused';
    if (prior) {
      if (
        prior.kind !== kind ||
        prior.actorId !== args.actorId ||
        prior.requesterSessionId !== args.requesterSessionId
      )
        throw new Error('Idempotency key conflict');
      await this.write(document);
      return;
    }
    document.definition = {
      ...document.definition,
      enabled: args.enabled,
      updatedAt: args.now,
      ...(args.enabled ? { activationId: args.activationId, activeFrom: args.now } : {}),
    };
    document.timeline.push(
      v.parse(activitySchema, {
        id: args.requestId,
        kind,
        actorId: args.actorId,
        createdAt: args.now,
        ...(args.requesterSessionId ? { requesterSessionId: args.requesterSessionId } : {}),
      }),
    );
    await this.write(document);
  };
  delete = async (scheduleId: string, actorId: string, now: number) => {
    const existing = (await this.storage.scan()).find(
      (entry) => entry.key[0] === 'tombstone' && entry.key[1] === scheduleId,
    );
    if (existing) {
      const tombstone = v.parse(tombstoneSchema, existing.value);
      if (tombstone.actorId !== actorId) throw new Error('Only the Schedule owner can delete it');
      await this.storage.writeRegistry(['tombstone', scheduleId], tombstone);
      return;
    }
    await this.owned(scheduleId, actorId);
    await this.storage.writeRegistry(
      ['tombstone', scheduleId],
      v.parse(tombstoneSchema, { deletedAt: now, actorId }),
    );
  };
  requestRun = async (args: ScheduleRunRequest) => {
    const document = await this.owned(args.scheduleId, args.actorId);
    const request = v.parse(manualSchema, {
      scheduleId: args.scheduleId,
      actorId: args.actorId,
      manualRunId: args.manualRunId,
      activationId: document.definition.activationId,
      requestedAt: args.now,
    });
    const existing = (await this.storage.scan()).find(
      (entry) =>
        entry.key[0] === 'manual' &&
        entry.key[1] === args.scheduleId &&
        entry.key[2] === args.manualRunId,
    );
    if (existing) {
      const prior = v.parse(manualSchema, existing.value);
      if (
        canonicalScheduleJson({ ...prior, requestedAt: 0 }) !==
        canonicalScheduleJson({ ...request, requestedAt: 0 })
      )
        throw new Error('Idempotency key conflict');
      await this.storage.writeRegistry(['manual', args.scheduleId, args.manualRunId], prior);
      return;
    }
    await this.storage.writeRegistry(['manual', args.scheduleId, args.manualRunId], request);
  };
}
