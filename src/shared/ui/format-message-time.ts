// Lody lib/format-conversation-timestamp.ts; extension clocks are local, not server-synchronized.
const DAY = 24 * 60 * 60 * 1000;
const options = {
  time: { hour: '2-digit', minute: '2-digit' },
  weekday: { weekday: 'long' },
  fullDate: { year: 'numeric', month: 'numeric', day: 'numeric' },
  monthDay: { month: 'numeric', day: 'numeric' },
} satisfies Record<string, Intl.DateTimeFormatOptions>;
const cache = new Map<string, Intl.DateTimeFormat>();
const calendarDay = (date: Date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY;

export function formatMessageTime(
  timestamp: number | undefined,
  { now = Date.now(), locale }: { now?: number; locale?: string } = {},
) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const current = new Date(now);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(current.getTime())) return '';
  const format = (kind: keyof typeof options) => {
    const key = `${locale ?? ''}|${kind}`;
    let formatter = cache.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, options[kind]);
      cache.set(key, formatter);
    }
    return formatter.format(date);
  };
  const daysAgo = calendarDay(current) - calendarDay(date);
  if (daysAgo === 0) return format('time');
  if (daysAgo > 0 && daysAgo < 7) return `${format('weekday')} ${format('time')}`;
  const year = current.getFullYear() - 1;
  const lastDay = new Date(year, current.getMonth() + 1, 0).getDate();
  const cutoff = Date.UTC(year, current.getMonth(), Math.min(current.getDate(), lastDay)) / DAY;
  return `${format(calendarDay(date) <= cutoff ? 'fullDate' : 'monthDay')} ${format('time')}`;
}
