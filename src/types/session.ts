import type { SportKey } from '@/types/sport';

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
  targetPosition: string | null;
  /** Reuse key into the shared `cue_images` catalog, or null (ADR 0012). */
  cueImageKey?: string | null;
  qualityGatePassed: boolean;
  thumbsUp: boolean | null;
  /** Reason chosen on a 👎 (single-select), or null/undefined. */
  feedbackReason?: string | null;
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
  coachingCue: string;
  targetPosition: string;
  qualityGatePassed: boolean;
  pipelineVersion: string;
  /** Reuse key into the shared cue-image catalog, or null (ADR 0012). */
  cueImageKey?: string | null;
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
  coachingCue: string;
  targetPosition: string;
  qualityGatePassed: boolean;
  pipelineVersion: string;
  /** Regenerated cue-image reuse key, or null (ADR 0012). */
  cueImageKey?: string | null;
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
