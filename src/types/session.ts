import type { SportKey } from '@/types/sport';
import type { GiSource } from '@/sports/giContext';
import type { GiPreference } from '@/types/user';

/**
 * Mirrors the `public.sessions` table — the core persisted entity.
 * camelCase here; the storage provider maps to/from snake_case columns.
 */
export interface Session {
  id: string;
  userId: string;
  sportKey: SportKey;
  sessionDate: string;
  audioStoragePath: string | null;
  rawTranscript: string | null;
  positionsVisited: string[];
  keyMistake: string | null;
  opponentAction: string | null;
  sentiment: string | null;
  coachingCue: string | null;
  /**
   * Canonical position id (issue #48), e.g. `side-control-bottom`. Null when
   * the position or the side is undetermined — the free-text `targetPosition`
   * is a display label, not a key.
   */
  targetPositionId: string | null;
  /**
   * Attire for this session (#43). Null on rows predating the column;
   * grounding treats null as unknown and excludes gi-specific records.
   */
  gi: GiPreference | null;
  /** Where `gi` came from: the toggle, an explicit statement, or nothing (#60). */
  giSource: GiSource | null;
  targetPosition: string | null;
  qualityGatePassed: boolean;
  thumbsUp: boolean | null;
  /** Reason chosen on a 👎 (single-select), or null/undefined. */
  feedbackReason?: string | null;
  /**
   * Optional free-text note on a 👎 — what was wrong / how to improve.
   * Independent of `feedbackReason`. Null/undefined when not provided.
   */
  feedbackNote?: string | null;
  pipelineVersion: string | null;
  createdAt: string;
}

/** Shape written when persisting a freshly-processed session. */
export interface NewSession {
  userId: string;
  sportKey: SportKey;
  sessionDate: string;
  audioStoragePath: string | null;
  rawTranscript: string;
  positionsVisited: string[];
  keyMistake: string;
  opponentAction: string;
  sentiment: string;
  /**
   * Null when the pipeline declined to produce a cue (issue #44) — the
   * recording had nothing coachable in it. A Session with no cue is still a
   * Session: it is saved, it counts toward the streak, and it contributes
   * nothing to trends (no position, no mistake).
   */
  coachingCue: string | null;
  targetPosition: string | null;
  /** Canonical position id (issue #48). Null when undetermined. */
  targetPositionId: string | null;
  qualityGatePassed: boolean;
  pipelineVersion: string;
  /** Why the cue was or was not grounded, and which arm it landed in (#58). */
  /** Attire for this session (#43). */
  gi?: GiPreference | null;
  /** Where `gi` came from (#60). */
  giSource?: GiSource | null;
  grounding?: string | null;
  /** Records actually injected. */
  groundingRecords?: number | null;
  /** Records that matched and could have been injected — the control's counterfactual. */
  groundingAvailable?: number | null;
}

/**
 * Fields overwritten when a Session is re-analyzed in place (corrected
 * transcript → regenerated cue). The identity fields (user, sport, date,
 * audio) are untouched — this is the same reflection, freshly analyzed.
 */
export interface SessionAnalysisUpdate {
  rawTranscript: string;
  positionsVisited: string[];
  keyMistake: string;
  opponentAction: string;
  sentiment: string;
  /**
   * Null when the pipeline declined to produce a cue (issue #44) — the
   * recording had nothing coachable in it. A Session with no cue is still a
   * Session: it is saved, it counts toward the streak, and it contributes
   * nothing to trends (no position, no mistake).
   */
  coachingCue: string | null;
  targetPosition: string | null;
  /** Canonical position id (issue #48). Null when undetermined. */
  targetPositionId: string | null;
  qualityGatePassed: boolean;
  pipelineVersion: string;
  /** Why the cue was or was not grounded, and which arm it landed in (#58). */
  /** Attire for this session (#43). */
  gi?: GiPreference | null;
  /** Where `gi` came from (#60). */
  giSource?: GiSource | null;
  grounding?: string | null;
  /** Records actually injected. */
  groundingRecords?: number | null;
  /** Records that matched and could have been injected — the control's counterfactual. */
  groundingAvailable?: number | null;
}

/** Mirrors the `public.user_trends` table. */
export interface UserTrends {
  userId: string;
  sportKey: SportKey;
  dominantWeakness: string | null;
  positionsStruggled: Record<string, number>;
  sessionCount: number;
  streakDays: number;
  lastSessionAt: string | null;
  updatedAt: string;
}
