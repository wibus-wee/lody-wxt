import type {
  ScheduleDocument,
  ScheduleEnable,
  ScheduleRegistryRow,
  ScheduleRunRequest,
  ScheduleRuntimeRow,
  ScheduleSave,
} from '../domain/models.js';

export interface ScheduleRepository {
  list: () => Promise<ScheduleRegistryRow[]>;
  runtimeRows: () => Promise<ScheduleRuntimeRow[]>;
  read: (scheduleId: string) => Promise<ScheduleDocument | null>;
  save: (input: ScheduleSave) => Promise<ScheduleDocument>;
  setEnabled: (input: ScheduleEnable) => Promise<void>;
  delete: (scheduleId: string, actorId: string, now: number) => Promise<void>;
  requestRun: (input: ScheduleRunRequest) => Promise<void>;
}
