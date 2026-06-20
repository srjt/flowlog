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

export interface SportTrends {
  sessionCount: number;
  streakDays: number;
  lastSessionAt: string | null;
  /** The position you log most — your current focus area. */
  focusArea: string | null;
  topPositions: Tally[];
  /** Distinct recent key mistakes, newest first. */
  recentMistakes: string[];
  moodBreakdown: Tally[];
  /** Fraction of rated cues marked helpful (0–1), or null if none rated. */
  thumbsUpRate: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
    if (s.sentiment) counts.set(s.sentiment, (counts.get(s.sentiment) ?? 0) + 1);
  }
  return tallyArray(counts);
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
