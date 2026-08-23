import type { CoachingRecord } from '@/types/pipeline';
import type {
  NewSession,
  Session,
  SessionAnalysisUpdate,
  UserTrends,
} from '@/types/session';

/**
 * Storage provider contract — abstracts persistence (audio blobs + relational
 * rows) so the backend can be swapped without touching the pipeline. Active:
 * Supabase.
 */
export interface IStorageProvider {
  /** Upload the recorded audio file; returns the stored path/key. */
  uploadAudio(userId: string, audioUri: string): Promise<string>;

  /** Persist a processed session; returns the created row. */
  saveSession(session: NewSession): Promise<Session>;

  /**
   * Re-analysis: overwrite an existing session's analysis fields in place
   * (corrected transcript → new cue). Returns the updated row. RLS-scoped to
   * the owner.
   */
  updateSessionAnalysis(
    sessionId: string,
    update: SessionAnalysisUpdate,
  ): Promise<Session>;

  /** Most recent sessions for a user, newest first. */
  listSessions(userId: string, limit?: number): Promise<Session[]>;

  /** The last N key mistakes for a user — feeds the coaching prompt. */
  getRecentMistakes(userId: string, limit: number): Promise<string[]>;

  /** Current computed trends for a user/sport, or null if none yet. */
  getUserTrends(userId: string, sportKey: string): Promise<UserTrends | null>;

  /**
   * Record thumbs-up/down feedback on a session, with an optional 👎 reason
   * category and an optional independent free-text note.
   */
  setSessionFeedback(
    sessionId: string,
    thumbsUp: boolean,
    reason?: string | null,
    note?: string | null,
  ): Promise<void>;

  /** Permanently delete a session (RLS-scoped to the owner). */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * Instructional records for the given canonical positions (#57).
   *
   * Server-side reference data: the table's grants are revoked for clients, so
   * only a service-role caller can read it. Client-side implementations
   * legitimately return an empty array — the live pipeline runs in the edge
   * function, and an ungrounded cue is a supported outcome, not an error.
   */
  getCoachingRecords(
    sportKey: string,
    positionIds: string[],
  ): Promise<CoachingRecord[]>;

  isAvailable(): Promise<boolean>;
}
