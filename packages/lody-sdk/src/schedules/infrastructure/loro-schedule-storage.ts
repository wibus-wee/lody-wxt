import { LoroMap } from 'loro-crdt';
import type { LoroRepo } from 'loro-repo';
import * as v from 'valibot';

import { acquireWithin, bounded } from '../../shared/infrastructure/lifecycle.js';
import type { ScheduleDocument } from '../domain/models.js';
import type { ScheduleRegistryValue, ScheduleStorage } from './schedule-repository.js';

export class LoroScheduleStorage implements ScheduleStorage {
  constructor(
    private readonly options: {
      repo: LoroRepo;
      workspaceId: string;
      signal: AbortSignal;
      timeoutMs: number;
    },
  ) {}
  private signal() {
    return AbortSignal.any([this.options.signal, AbortSignal.timeout(this.options.timeoutMs)]);
  }
  private async registry<T>(
    action: (
      resource: Awaited<ReturnType<LoroRepo['acquireFlockDoc']>>,
      flush: () => Promise<void>,
    ) => Promise<T>,
  ) {
    const id = `${this.options.workspaceId}:sr`;
    const signal = this.signal();
    const lease = await acquireWithin(this.options.repo.acquireFlockDoc(id), signal, (resource) =>
      resource.release(),
    );
    let room;
    try {
      room = await acquireWithin(
        this.options.repo.joinFlockDocRoom(id),
        signal,
        async (resource) => {
          resource.unsubscribe();
        },
      );
      await bounded(room.firstSyncedWithRemote, signal);
      const currentRoom = room;
      return await action(lease, async () => {
        signal.throwIfAborted();
        lease.flock.commit();
        await this.options.repo.persistFlockDocNow(id, lease.flock);
        await bounded(currentRoom.waitUntilSynced(), signal);
      });
    } finally {
      room?.unsubscribe();
      await lease.release();
    }
  }
  scan = () => this.registry(async (lease) => Array.from(lease.flock.scanValues()));
  writeRegistry = (key: string[], value: ScheduleRegistryValue) =>
    this.registry(async (lease, flush) => {
      lease.flock.set(key, JSON.parse(JSON.stringify(value)));
      await flush();
    });
  private async document<T>(
    scheduleId: string,
    action: (
      resource: Awaited<ReturnType<LoroRepo['acquireDoc']>>,
      flush: () => Promise<void>,
    ) => Promise<T>,
  ) {
    const id = `schedule-${scheduleId}`;
    const signal = this.signal();
    const lease = await acquireWithin(this.options.repo.acquireDoc(id), signal, (resource) =>
      resource.release(),
    );
    let room;
    try {
      room = await acquireWithin(this.options.repo.joinDocRoom(id), signal, async (resource) => {
        resource.unsubscribe();
      });
      await bounded(room.firstSyncedWithRemote, signal);
      const currentRoom = room;
      return await action(lease, async () => {
        signal.throwIfAborted();
        lease.doc.commit();
        await this.options.repo.persistDocNow(id, lease.doc);
        await bounded(currentRoom.waitUntilSynced(), signal);
      });
    } finally {
      room?.unsubscribe();
      await lease.release();
    }
  }
  readDocument = (scheduleId: string) =>
    this.document(scheduleId, async (lease) => {
      const raw = lease.doc.toJSON();
      return Object.keys(raw).length === 0 ? null : raw;
    });
  writeDocument = (document: ScheduleDocument) =>
    this.document(document.definition.scheduleId, async (lease, flush) => {
      const definition = lease.doc.getMap('definition');
      for (const key of definition.keys())
        if (!(key in document.definition)) definition.delete(key);
      for (const [key, value] of Object.entries(document.definition)) {
        if (value !== undefined) definition.set(key, JSON.parse(JSON.stringify(value)));
      }
      lease.doc.getText('prompt').update(document.prompt);
      const timeline = lease.doc.getList('timeline');
      const existing = v.parse(v.array(v.object({ id: v.string() })), timeline.toJSON());
      const ids = new Set(existing.map((entry) => entry.id));
      for (const activity of document.timeline) {
        if (ids.has(activity.id)) continue;
        const entry = timeline.insertContainer(timeline.length, new LoroMap());
        for (const [key, value] of Object.entries(activity))
          if (value !== undefined) entry.set(key, value);
      }
      await flush();
    });
}
