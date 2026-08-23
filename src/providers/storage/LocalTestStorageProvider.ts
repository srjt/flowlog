import type { IStorageProvider } from '@/providers/storage/IStorageProvider';
import { computeTrends } from '@/services/TrendsService';
import type {
  NewSession,
  Session,
  SessionAnalysisUpdate,
  UserTrends,
} from '@/types/session';
import type { SportKey } from '@/types/sport';

/**
 * In-memory storage for the LOCAL TEST pipeline. Lets the real FlowlogPipeline
 * run end-to-end without Supabase: audio "upload" is a no-op, sessions live in
 * a module array for the lifetime of the app session, and recent mistakes feed
 * the coaching prompt across runs. Never used in production (that's
 * SupabaseStorageProvider).
 */
const sessions: Session[] = [];

export class LocalTestStorageProvider implements IStorageProvider {
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async uploadAudio(userId: string, _audioUri: string): Promise<string> {
    return `local/${userId}/${Date.now()}.audio`;
  }

  async saveSession(session: NewSession): Promise<Session> {
    const row: Session = {
      id: `local-${Date.now()}-${sessions.length}`,
      userId: session.userId,
      sportKey: session.sportKey,
      sessionDate: session.sessionDate,
      audioStoragePath: session.audioStoragePath,
      rawTranscript: session.rawTranscript,
      positionsVisited: session.positionsVisited,
      keyMistake: session.keyMistake,
      opponentAction: session.opponentAction,
      sentiment: session.sentiment,
      coachingCue: session.coachingCue,
      targetPositionId: session.targetPositionId,
      targetPosition: session.targetPosition,
      qualityGatePassed: session.qualityGatePassed,
      thumbsUp: null,
      feedbackReason: null,
      feedbackNote: null,
      pipelineVersion: session.pipelineVersion,
      createdAt: new Date().toISOString(),
    };
    sessions.unshift(row);
    return row;
  }

  async updateSessionAnalysis(
    sessionId: string,
    update: SessionAnalysisUpdate,
  ): Promise<Session> {
    const row = sessions.find((s) => s.id === sessionId);
    if (!row) throw new Error(`Session not found: ${sessionId}`);
    Object.assign(row, {
      rawTranscript: update.rawTranscript,
      positionsVisited: update.positionsVisited,
      keyMistake: update.keyMistake,
      opponentAction: update.opponentAction,
      sentiment: update.sentiment,
      coachingCue: update.coachingCue,
      targetPositionId: update.targetPositionId,
      targetPosition: update.targetPosition,
      qualityGatePassed: update.qualityGatePassed,
      pipelineVersion: update.pipelineVersion,
    });
    return row;
  }

  async listSessions(userId: string, limit = 50): Promise<Session[]> {
    return sessions.filter((s) => s.userId === userId).slice(0, limit);
  }

  async getRecentMistakes(userId: string, limit: number): Promise<string[]> {
    return sessions
      .filter((s) => s.userId === userId && s.keyMistake)
      .slice(0, limit)
      .map((s) => s.keyMistake as string);
  }

  async getUserTrends(
    userId: string,
    sportKey: string,
  ): Promise<UserTrends | null> {
    const mine = sessions.filter(
      (s) => s.userId === userId && s.sportKey === sportKey,
    );
    if (mine.length === 0) return null;
    const t = computeTrends(mine);
    const positionsStruggled: Record<string, number> = {};
    for (const p of t.topPositions) positionsStruggled[p.label] = p.count;
    return {
      userId,
      sportKey: sportKey as SportKey,
      dominantWeakness: t.focusArea,
      positionsStruggled,
      sessionCount: t.sessionCount,
      streakDays: t.streakDays,
      lastSessionAt: t.lastSessionAt,
      updatedAt: new Date().toISOString(),
    };
  }

  async setSessionFeedback(
    sessionId: string,
    thumbsUp: boolean,
    reason?: string | null,
    note?: string | null,
  ): Promise<void> {
    const row = sessions.find((s) => s.id === sessionId);
    if (row) {
      row.thumbsUp = thumbsUp;
      row.feedbackReason = reason ?? null;
      row.feedbackNote = note ?? null;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const i = sessions.findIndex((s) => s.id === sessionId);
    if (i >= 0) sessions.splice(i, 1);
  }
}

export const localTestStorage = new LocalTestStorageProvider();
