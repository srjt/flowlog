import { isDemoMode, isLocalPipeline } from '@/config/featureFlags';
import { buildDemoHistory } from '@/pipeline/demoData';
import { storageProvider } from '@/providers/storage';
import { localTestStorage } from '@/providers/storage/LocalTestStorageProvider';
import type { Session } from '@/types/session';
import type { SportKey } from '@/types/sport';

/**
 * Load a user's sessions from the right source for the current mode:
 *   - demo → seeded sample sessions
 *   - local-test → in-memory store
 *   - production → Supabase
 * Used by both the Log and Trends screens so the source logic lives in one place.
 */
export async function loadSessions(
  userId: string,
  sportKey: SportKey,
): Promise<Session[]> {
  if (isDemoMode) return buildDemoHistory(userId, sportKey);
  if (isLocalPipeline) return localTestStorage.listSessions(userId);
  return storageProvider.listSessions(userId);
}

/** Persist thumbs feedback (+ optional 👎 reason) for the current mode. */
export async function saveSessionFeedback(
  sessionId: string,
  thumbsUp: boolean,
  reason?: string | null,
): Promise<void> {
  if (isDemoMode) return; // nothing persistent to write
  if (isLocalPipeline) {
    await localTestStorage.setSessionFeedback(sessionId, thumbsUp, reason);
    return;
  }
  await storageProvider.setSessionFeedback(sessionId, thumbsUp, reason);
}

/** Permanently delete a session for the current mode. */
export async function deleteSession(sessionId: string): Promise<void> {
  if (isDemoMode) return; // demo history is seeded; nothing to delete
  if (isLocalPipeline) {
    await localTestStorage.deleteSession(sessionId);
    return;
  }
  await storageProvider.deleteSession(sessionId);
}
