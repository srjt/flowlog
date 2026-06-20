import type { NewSession, Session, UserTrends } from '@/types/session';

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

  /** Most recent sessions for a user, newest first. */
  listSessions(userId: string, limit?: number): Promise<Session[]>;

  /** The last N key mistakes for a user — feeds the coaching prompt. */
  getRecentMistakes(userId: string, limit: number): Promise<string[]>;

  /** Current computed trends for a user/sport, or null if none yet. */
  getUserTrends(userId: string, sportKey: string): Promise<UserTrends | null>;

  /** Record thumbs-up/down feedback (and optional 👎 reason) on a session. */
  setSessionFeedback(
    sessionId: string,
    thumbsUp: boolean,
    reason?: string | null,
  ): Promise<void>;

  /** Permanently delete a session (RLS-scoped to the owner). */
  deleteSession(sessionId: string): Promise<void>;

  isAvailable(): Promise<boolean>;
}
