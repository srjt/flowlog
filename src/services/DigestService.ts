import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  applyDigestPrefs,
  buildDigestBody,
} from '@/services/NotificationService';
import { computeTrends, type SportTrends } from '@/services/TrendsService';
import type { DigestPrefs } from '@/types/notifications';
import type { Session } from '@/types/session';
import type { SportKey } from '@/types/sport';
import { logger } from '@/utils/logger';

/**
 * Weekly Digest: durable, reviewable snapshots of the once-a-week recap that the
 * digest notification only ever showed as a disappearing string. Everything is
 * LOCAL (AsyncStorage, no server, no API keys), consistent with the reminder /
 * digest notification design.
 *
 * A `WeeklyDigest` is a self-contained snapshot of one completed week — it is
 * NOT recomputed from live trends when opened, so history reflects what each
 * week actually looked like. Snapshots are keyed by week-start date (+ sport),
 * which makes `materializeDueDigests` naturally idempotent: re-running never
 * duplicates a week, so it's safe to call liberally on app foreground / when the
 * digest surfaces open (local notifications can't run code when they fire, so we
 * catch up any weeks the user was away for on the next run).
 */
export interface WeeklyDigest {
  /** Stable per-week id: `${sport}-${weekStart}` (e.g. "bjj-2026-06-08"). */
  id: string;
  /** ISO date (yyyy-mm-dd) of the week's Monday — matches the Log's grouping. */
  weekStart: string;
  sport: SportKey;
  /** Most-worked position that week, or null if none noted. */
  focusArea: string | null;
  /** Top recurring key mistake that week, or null if none flagged. */
  recurringLeak: string | null;
  /** Human-readable recap — identical in wording to the notification body. */
  body: string;
}

const HISTORY_KEY = 'flowlog.digestHistory.v1';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Local-midnight Monday that starts the week containing `d`. Mirrors
 * `groupSessionsByWeek` so a digest's week aligns exactly with the Log's weeks.
 */
function weekStartDate(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const mondayOffset = (x.getDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0, …
  x.setDate(x.getDate() - mondayOffset);
  return x;
}

function weekStartKey(d: Date): string {
  return weekStartDate(d).toISOString().slice(0, 10);
}

/** Compose the stable per-week id from its sport and week-start key. */
function digestId(sport: SportKey, weekStart: string): string {
  return `${sport}-${weekStart}`;
}

/**
 * Build a `WeeklyDigest` snapshot from that week's `SportTrends`. Reuses
 * `buildDigestBody` so the stored recap and the scheduled notification read
 * identically.
 */
export function buildWeeklyDigest(
  trends: SportTrends,
  weekStart: string,
  sport: SportKey,
): WeeklyDigest {
  return {
    id: digestId(sport, weekStart),
    weekStart,
    sport,
    focusArea: trends.focusArea,
    recurringLeak: trends.recentMistakes[0] ?? null,
    body: buildDigestBody(trends),
  };
}

/**
 * Pure catch-up: given the user's sessions, the current time, and existing
 * history, return the history extended with a snapshot for every ELAPSED week
 * (fully in the past relative to `now`) that has activity and isn't already
 * captured. The in-progress current week is intentionally excluded — a digest
 * recaps a completed week. Deterministic (clock passed in) and idempotent
 * (keyed by week-start), so repeated runs never duplicate a week. Result is
 * sorted newest week first.
 */
export function materializeDueDigests(
  sessions: Session[],
  now: Date,
  history: WeeklyDigest[],
): WeeklyDigest[] {
  const nowMs = now.getTime();
  const buckets = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = weekStartKey(new Date(s.sessionDate));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(s);
    else buckets.set(key, [s]);
  }

  const existing = new Set(history.map((d) => d.id));
  const additions: WeeklyDigest[] = [];
  for (const [weekStart, weekSessions] of buckets) {
    // Buckets are only created with a session, so the first is always present.
    const first = weekSessions[0];
    if (!first) continue;
    // Only weeks that have fully elapsed — skip the in-progress current week.
    const weekEndMs = Date.parse(`${weekStart}T00:00:00Z`) + WEEK_MS;
    if (weekEndMs > nowMs) continue;
    const sport = first.sportKey;
    if (existing.has(digestId(sport, weekStart))) continue;
    additions.push(
      buildWeeklyDigest(computeTrends(weekSessions), weekStart, sport),
    );
  }

  return [...history, ...additions].sort((a, b) =>
    a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0,
  );
}

/** Load persisted digest history (newest first). Empty on first run or error. */
export async function loadDigestHistory(): Promise<WeeklyDigest[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WeeklyDigest[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.warn('loadDigestHistory failed', err);
    return [];
  }
}

/** Persist digest history. Best-effort — a failed write never throws. */
export async function persistDigestHistory(
  history: WeeklyDigest[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (err) {
    logger.warn('persistDigestHistory failed', err);
  }
}

/**
 * Load history, materialize any newly-elapsed weeks from `sessions`, persist if
 * it grew, and return the up-to-date history. The single IO entry point the
 * digest surfaces call on open.
 */
export async function syncDigestHistory(
  sessions: Session[],
  now: Date = new Date(),
): Promise<WeeklyDigest[]> {
  const history = await loadDigestHistory();
  const next = materializeDueDigests(sessions, now, history);
  if (next.length !== history.length) await persistDigestHistory(next);
  return next;
}

/**
 * Materialize any newly-elapsed digests from `sessions`, then (re)schedule the
 * weekly notification with the latest stored digest's body — so the banner text
 * matches the `/digest` page it opens. Falls back to the live-trends summary
 * when no digest has been captured yet (e.g. a brand-new user whose only
 * activity is the in-progress week). The single call the Trends screen and the
 * digest settings use to keep the notification and history in sync. Returns the
 * effective prefs (from `applyDigestPrefs`) and the up-to-date history.
 */
export async function applyDigestPrefsWithHistory(
  prefs: DigestPrefs,
  sessions: Session[],
  now: Date = new Date(),
): Promise<{ prefs: DigestPrefs; history: WeeklyDigest[] }> {
  const history = await syncDigestHistory(sessions, now);
  const trends = computeTrends(sessions);
  const latestBody = history[0]?.body ?? null;
  const effective = await applyDigestPrefs(prefs, trends, latestBody);
  return { prefs: effective, history };
}

/** Friendly week label for the UI, e.g. "Week of Jun 8, 2026". */
export function formatWeekLabel(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00`);
  return `Week of ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}
