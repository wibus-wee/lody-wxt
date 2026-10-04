import { Cron } from 'croner';

import type { ScheduleTrigger } from '../domain/models.js';
import { validateTrigger } from './schemas.js';

export function previewSchedule(
  value: ScheduleTrigger,
  activeFrom: number,
  now: number,
  count = 5,
): number[] {
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > 100 ||
    !Number.isFinite(activeFrom) ||
    !Number.isFinite(now)
  )
    throw new Error('Invalid schedule preview');
  const trigger = validateTrigger(value);
  const result: number[] = [];
  let after = now;
  for (let index = 0; index < count; index++) {
    const lower = Math.max(activeFrom, after + 1);
    let next: number | undefined;
    if (trigger.kind === 'manual') break;
    if (trigger.kind === 'once') {
      const at = Date.parse(trigger.at);
      next = at >= lower ? at : undefined;
    } else if (trigger.kind === 'interval') {
      const anchor = Date.parse(trigger.anchorAt);
      next = anchor + Math.max(0, Math.ceil((lower - anchor) / trigger.everyMs)) * trigger.everyMs;
    } else {
      const schedule = new Cron(trigger.expression, {
        timezone: trigger.timeZone,
        paused: true,
        domAndDow: false,
      });
      let candidate = schedule.nextRun(new Date(lower - 1));
      while (candidate && !schedule.match(candidate)) candidate = schedule.nextRun(candidate);
      next = candidate?.getTime();
    }
    if (next === undefined) break;
    result.push(next);
    after = next;
  }
  return result;
}
