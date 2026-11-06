import type { Session } from '@/types/session';

/**
 * Computed training trends for one sport, derived purely from a list of
 * sessions. No network — the Trends screen aggregates the user's saved sessions
 * client-side. Pure and deterministic so it's unit-tested.
 */
export interface Tally {
  label: string;
  count: number;
}

/**
 * A recurring Weakness (#1; see `CONTEXT.md`): the position where the athlete's
 * key mistake keeps landing. NOT the Focus area. Most-logged is not
 * most-troublesome, and before #1 the trend log only ever surfaced most-logged
 * plus the newest mistake.
 *
 * The signal is the Session's `targetPositionId`: the canonical,
 * perspective-aware position Extraction tied that Session's key mistake to
 * (`half-guard-bottom`, never "half guard"). Free-text mistakes are NOT
 * clustered by shared words. "Got flattened" and "lost my frames" can be the
 * same problem with no words in common, and the repo's findings log (#139)
 * records how often keyword proxies misled. A canonical id either repeats or it
 * does not.
 */
export interface Weakness {
  /** Canonical position id, e.g. `half-guard-bottom`. */
  positionId: string;
  /** Display label as stored on the most recent Session that targeted it. */
  label: string;
  /** Sessions in the window whose key mistake targeted this position. */
  count: number;
  /** Sessions considered: the most recent ones with a mistake and a position. */
  window: number;
  /** The most recent key mistake at this position. */
  latestMistake: string;
}

export interface SportTrends {
  sessionCount: number;
  streakDays: number;
  lastSessionAt: string | null;
  /** The position you log most — your current focus area. */
  focusArea: string | null;
  topPositions: Tally[];
  /**
   * The position your key mistakes keep coming back to, or null when none has
   * recurred yet. See `Weakness`.
   */
  weakness: Weakness | null;
  /** Distinct recent key mistakes, newest first. */
  recentMistakes: string[];
  moodBreakdown: Tally[];
  /** Fraction of rated cues marked helpful (0–1), or null if none rated. */
  thumbsUpRate: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many recent mistake-bearing Sessions a Weakness is judged over. Recent
 * enough that a fixed problem drops out, long enough to see a pattern at a
 * couple of sessions a week.
 */
export const WEAKNESS_WINDOW = 10;

/**
 * A position must carry the key mistake in at least this many Sessions of the
 * window to count as recurring. One occurrence is an incident, not a pattern.
 */
export const WEAKNESS_MIN_RECURRENCE = 2;

export function computeTrends(sessions: Session[]): SportTrends {
  const sorted = [...sessions].sort((a, b) =>
    a.sessionDate < b.sessionDate ? 1 : -1,
  );

  return {
    sessionCount: sorted.length,
    streakDays: computeStreak(sorted),
    lastSessionAt: sorted[0]?.sessionDate ?? null,
    focusArea: topTally(positionTallies(sorted))?.label ?? null,
    topPositions: positionTallies(sorted).slice(0, 5),
    weakness: computeWeakness(sorted),
    recentMistakes: distinctRecentMistakes(sorted, 5),
    moodBreakdown: moodTallies(sorted),
    thumbsUpRate: computeThumbsUpRate(sorted),
  };
}

/** Consecutive calendar days (UTC) of training, ending at the latest session. */
function computeStreak(sessions: Session[]): number {
  const days = Array.from(
    new Set(sessions.map((s) => s.sessionDate.slice(0, 10))),
  ).sort((a, b) => (a < b ? 1 : -1)); // newest first
  if (days.length === 0) return 0;

  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = Date.parse(`${days[i - 1]}T00:00:00Z`);
    const curr = Date.parse(`${days[i]}T00:00:00Z`);
    if (prev - curr === DAY_MS) streak += 1;
    else break;
  }
  return streak;
}

function positionTallies(sessions: Session[]): Tally[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    for (const pos of s.positionsVisited ?? []) {
      const key = pos.trim();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return tallyArray(counts);
}

function moodTallies(sessions: Session[]): Tally[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (s.sentiment)
      counts.set(s.sentiment, (counts.get(s.sentiment) ?? 0) + 1);
  }
  return tallyArray(counts);
}

/**
 * The recurring Weakness, from Sessions sorted newest first. Only Sessions that
 * have both a key mistake and a canonical target position count:
 * - a declined Take has neither;
 * - a mistake about a submission or a transition resolves to no position (#116);
 * - a Session from before position ids existed (migration 007) has none.
 * None of these is evidence about a position, so none can make one recur.
 *
 * The most frequent position in the window wins if it reaches the recurrence
 * floor. A tie goes to the position whose mistake is most recent, because that
 * is the one still happening.
 */
function computeWeakness(sessions: Session[]): Weakness | null {
  const window = sessions
    .filter((s) => s.targetPositionId && s.keyMistake?.trim())
    .slice(0, WEAKNESS_WINDOW);

  // `window` is newest first, so the first Session seen for an id is its most
  // recent occurrence: it supplies the label, the latest mistake and the
  // recency used to break ties.
  interface Candidate {
    positionId: string;
    count: number;
    label: string;
    latestMistake: string;
    latestIndex: number;
  }
  const byPosition = new Map<string, Candidate>();
  window.forEach((s, index) => {
    const positionId = s.targetPositionId as string;
    const seen = byPosition.get(positionId);
    if (seen) {
      seen.count += 1;
      return;
    }
    byPosition.set(positionId, {
      positionId,
      count: 1,
      label: s.targetPosition?.trim() || positionId,
      latestMistake: (s.keyMistake as string).trim(),
      latestIndex: index,
    });
  });

  let best: Candidate | null = null;
  for (const candidate of byPosition.values()) {
    if (candidate.count < WEAKNESS_MIN_RECURRENCE) continue;
    if (
      !best ||
      candidate.count > best.count ||
      (candidate.count === best.count &&
        candidate.latestIndex < best.latestIndex)
    ) {
      best = candidate;
    }
  }
  if (!best) return null;

  const { positionId, label, count, latestMistake } = best;
  return { positionId, label, count, window: window.length, latestMistake };
}

function distinctRecentMistakes(sessions: Session[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sessions) {
    const m = s.keyMistake?.trim();
    if (m && !seen.has(m.toLowerCase())) {
      seen.add(m.toLowerCase());
      out.push(m);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function computeThumbsUpRate(sessions: Session[]): number | null {
  const rated = sessions.filter((s) => s.thumbsUp !== null);
  if (rated.length === 0) return null;
  const up = rated.filter((s) => s.thumbsUp === true).length;
  return up / rated.length;
}

function tallyArray(counts: Map<string, number>): Tally[] {
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function topTally(tallies: Tally[]): Tally | null {
  return tallies[0] ?? null;
}
