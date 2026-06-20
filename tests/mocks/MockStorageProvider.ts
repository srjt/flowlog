import type { IStorageProvider } from '@/providers/storage/IStorageProvider';
import type { NewSession, Session, UserTrends } from '@/types/session';

/**
 * Full-interface storage mock. Records writes and serves configurable history.
 */
export class MockStorageProvider implements IStorageProvider {
  available = true;
  saved: NewSession[] = [];
  uploadedAudio: { userId: string; audioUri: string }[] = [];
  recentMistakes: string[] = [];
  trends: UserTrends | null = null;
  feedback: {
    sessionId: string;
    thumbsUp: boolean;
    reason?: string | null;
  }[] = [];
  deleted: string[] = [];
  failUpload = false;

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async uploadAudio(userId: string, audioUri: string): Promise<string> {
    if (this.failUpload) throw new Error('mock upload failure');
    this.uploadedAudio.push({ userId, audioUri });
    return `${userId}/mock-audio.m4a`;
  }

  async saveSession(session: NewSession): Promise<Session> {
    this.saved.push(session);
    return {
      id: `session-${this.saved.length}`,
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
      targetPosition: session.targetPosition,
      qualityGatePassed: session.qualityGatePassed,
      thumbsUp: null,
      pipelineVersion: session.pipelineVersion,
      createdAt: new Date().toISOString(),
    };
  }

  async listSessions(): Promise<Session[]> {
    return [];
  }

  async getRecentMistakes(): Promise<string[]> {
    return this.recentMistakes;
  }

  async getUserTrends(): Promise<UserTrends | null> {
    return this.trends;
  }

  async setSessionFeedback(
    sessionId: string,
    thumbsUp: boolean,
    reason?: string | null,
  ): Promise<void> {
    this.feedback.push({ sessionId, thumbsUp, reason: reason ?? null });
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.deleted.push(sessionId);
  }
}
