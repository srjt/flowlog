import type { Session } from '@/types/session';

export interface SessionSection {
  title: string;
  /** ISO date (yyyy-mm-dd) of the week's Monday — stable section key. */
  key: string;
  data: Session[];
}

/** Local-midnight Monday that starts the week containing `d`. */
function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const mondayOffset = (x.getDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0, …
  x.setDate(x.getDate() - mondayOffset);
  return x;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function weekTitle(start: Date, thisWeekStartMs: number): string {
  const diffWeeks = Math.round((thisWeekStartMs - start.getTime()) / WEEK_MS);
  if (diffWeeks === 0) return 'This week';
  if (diffWeeks === 1) return 'Last week';
  return `Week of ${start.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`;
}

/**
 * Group sessions into week sections, newest week first and newest session first
 * within each. Section titles are friendly ("This week", "Last week", or
 * "Week of Jun 9"). Pure — `now` is injectable for deterministic tests.
 */
export function groupSessionsByWeek(
  sessions: Session[],
  now: Date = new Date(),
): SessionSection[] {
  const sorted = [...sessions].sort(
    (a, b) => +new Date(b.sessionDate) - +new Date(a.sessionDate),
  );

  const buckets = new Map<string, Session[]>();
  for (const s of sorted) {
    const key = weekStart(new Date(s.sessionDate)).toISOString().slice(0, 10);
    const existing = buckets.get(key);
    if (existing) existing.push(s);
    else buckets.set(key, [s]);
  }

  const thisWeekMs = weekStart(now).getTime();
  return Array.from(buckets.entries()).map(([key, data]) => ({
    key,
    title: weekTitle(new Date(`${key}T00:00:00`), thisWeekMs),
    data,
  }));
}
