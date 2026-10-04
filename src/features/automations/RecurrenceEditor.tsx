import * as stylex from '@stylexjs/stylex';
import * as v from 'valibot';

import { Button, Field, Input } from '../../shared/ui';
import { ChoiceField } from '../conversations/ChoiceField';
import type { ScheduleRecurrence } from './recurrence';
import {
  changeScheduleRecurrenceKind,
  instantToZonedLocalInput,
  SCHEDULE_HOUR_STEPS,
  SCHEDULE_MINUTE_STEPS,
  SCHEDULE_RECURRENCE_KINDS,
  SCHEDULE_WEEKDAYS,
  zonedLocalInputToInstant,
} from './recurrence';
import { automationStyles as styles } from './styles';

const kindNames = {
  daily: '每天',
  weekdays: '工作日',
  weekly: '每周',
  monthly: '每月',
  hours: '每隔几小时',
  minutes: '每隔几分钟',
  once: '仅一次',
};
const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
export function RecurrenceEditor({
  value,
  onChange,
  timeZone,
  manual,
  onManualChange,
  disabled = false,
}: {
  value: ScheduleRecurrence;
  onChange: (value: ScheduleRecurrence) => void;
  timeZone: string;
  manual: boolean;
  onManualChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  let wallTime = null;
  switch (value.kind) {
    case 'daily':
    case 'weekdays':
    case 'weekly':
    case 'monthly':
      wallTime = value;
  }
  return (
    <div {...stylex.props(styles.section)}>
      <ChoiceField
        label="触发方式"
        value={manual ? 'manual' : 'timed'}
        disabled={disabled}
        choices={[
          { value: 'timed', label: '定时运行' },
          { value: 'manual', label: '手动运行' },
        ]}
        onChange={(next) => onManualChange(next === 'manual')}
      />
      {!manual && (
        <>
          {value.kind === 'unsupported' ? (
            <div {...stylex.props(styles.section)}>
              <p {...stylex.props(styles.hint)}>现有规则由其他客户端创建，保存时保持原样。</p>
              <pre {...stylex.props(styles.hint)}>{JSON.stringify(value.trigger)}</pre>
              <Button
                type="button"
                variant="ghost"
                size="small"
                disabled={disabled}
                onClick={() =>
                  onChange(changeScheduleRecurrenceKind(value, 'daily', Date.now(), timeZone))
                }
              >
                替换时间规则
              </Button>
            </div>
          ) : (
            <ChoiceField
              label="频率"
              value={value.kind}
              disabled={disabled}
              choices={SCHEDULE_RECURRENCE_KINDS.map((kind) => ({
                value: kind,
                label: kindNames[kind],
              }))}
              onChange={(next) =>
                onChange(
                  changeScheduleRecurrenceKind(
                    value,
                    v.parse(v.picklist(SCHEDULE_RECURRENCE_KINDS), next),
                    Date.now(),
                    timeZone,
                  ),
                )
              }
            />
          )}
          {wallTime && (
            <Field.Root disabled={disabled}>
              <Field.Label>时间</Field.Label>
              <Input
                type="time"
                aria-label="运行时间"
                value={`${String(wallTime.hour).padStart(2, '0')}:${String(wallTime.minute).padStart(2, '0')}`}
                onChange={(event) => {
                  const [hour, minute] = event.target.value.split(':').map(Number);
                  if (wallTime && Number.isInteger(hour) && Number.isInteger(minute))
                    onChange({ ...wallTime, hour: hour!, minute: minute! });
                }}
              />
            </Field.Root>
          )}
          {value.kind === 'once' && (
            <Field.Root disabled={disabled}>
              <Field.Label>日期和时间</Field.Label>
              <Input
                type="datetime-local"
                aria-label="单次运行日期和时间"
                value={instantToZonedLocalInput(Date.parse(value.at), timeZone)}
                onChange={(event) => {
                  const at = zonedLocalInputToInstant(event.target.value, timeZone);
                  if (at !== null) onChange({ kind: 'once', at: new Date(at).toISOString() });
                }}
              />
            </Field.Root>
          )}
          {value.kind === 'hours' && (
            <ChoiceField
              label="间隔小时"
              value={String(value.every)}
              disabled={disabled}
              choices={Array.from(new Set([...SCHEDULE_HOUR_STEPS, value.every]), (step) => ({
                value: String(step),
                label: `${step} 小时`,
              }))}
              onChange={(next) => onChange({ ...value, every: Number(next) })}
            />
          )}
          {value.kind === 'minutes' && (
            <ChoiceField
              label="间隔分钟"
              value={String(value.every)}
              disabled={disabled}
              choices={Array.from(new Set([...SCHEDULE_MINUTE_STEPS, value.every]), (step) => ({
                value: String(step),
                label: `${step} 分钟`,
              }))}
              onChange={(next) => onChange({ ...value, every: Number(next) })}
            />
          )}
          {value.kind === 'weekly' && (
            <section aria-label="运行星期" {...stylex.props(styles.row, styles.wrap)}>
              {SCHEDULE_WEEKDAYS.map((day) => (
                <Button
                  type="button"
                  key={day}
                  size="small"
                  variant={value.weekdays.includes(day) ? 'secondary' : 'ghost'}
                  aria-label={`星期${weekdays[day]}`}
                  aria-pressed={value.weekdays.includes(day)}
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...value,
                      weekdays: value.weekdays.includes(day)
                        ? value.weekdays.filter((item) => item !== day)
                        : [...value.weekdays, day],
                    })
                  }
                >
                  {weekdays[day]}
                </Button>
              ))}
            </section>
          )}
          {value.kind === 'monthly' && (
            <section aria-label="每月日期" {...stylex.props(styles.row, styles.wrap)}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                <Button
                  type="button"
                  key={day}
                  size="small"
                  variant={value.days.includes(day) ? 'secondary' : 'ghost'}
                  aria-label={`${day} 日`}
                  aria-pressed={value.days.includes(day)}
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...value,
                      days: value.days.includes(day)
                        ? value.days.filter((item) => item !== day)
                        : [...value.days, day],
                    })
                  }
                >
                  {day}
                </Button>
              ))}
            </section>
          )}
          <p {...stylex.props(styles.hint)}>运行机器时区：{timeZone}</p>
        </>
      )}
    </div>
  );
}
