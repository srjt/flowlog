// Force local-pipeline mode so saveSessionFeedback routes to the in-memory store.
jest.mock('@/config/featureFlags', () => ({
  isDemoMode: false,
  isLocalPipeline: true,
}));

import { localTestStorage } from '@/providers/storage/LocalTestStorageProvider';
import { saveSessionFeedback } from '@/services/sessionsSource';
import { useSessionStore } from '@/store/sessionStore';
import type { NewSession, Session } from '@/types/session';

function newSession(userId: string): NewSession {
  return {
    userId,
    sportKey: 'bjj',
    sessionDate: '2026-06-10T10:00:00.000Z',
    audioStoragePath: null,
    rawTranscript: 'transcript',
    positionsVisited: ['Guard'],
    keyMistake: 'm',
    opponentAction: 'o',
    sentiment: 'flat',
    coachingCue: 'cue',
    targetPosition: 'Guard',
    qualityGatePassed: true,
    pipelineVersion: 'test',
  };
}

function sampleSession(id: string): Session {
  return {
    id,
    userId: 'u',
    sportKey: 'bjj',
    sessionDate: '2026-06-10T10:00:00.000Z',
    audioStoragePath: null,
    rawTranscript: null,
    positionsVisited: [],
    keyMistake: null,
    opponentAction: null,
    sentiment: null,
    coachingCue: null,
    targetPosition: null,
    qualityGatePassed: true,
    thumbsUp: null,
    pipelineVersion: null,
    createdAt: '2026-06-10T10:00:00.000Z',
  };
}

describe('feedback reason', () => {
  it('saveSessionFeedback persists 👎 with a reason and 👍 without', async () => {
    const a = await localTestStorage.saveSession(newSession('uA'));
    const b = await localTestStorage.saveSession(newSession('uB'));

    await saveSessionFeedback(a.id, false, 'Too generic');
    await saveSessionFeedback(b.id, true);

    const la = await localTestStorage.listSessions('uA');
    const lb = await localTestStorage.listSessions('uB');
    expect(la[0]?.thumbsUp).toBe(false);
    expect(la[0]?.feedbackReason).toBe('Too generic');
    expect(lb[0]?.thumbsUp).toBe(true);
    expect(lb[0]?.feedbackReason).toBeNull();
  });

  it('store.setFeedback records the thumb and reason on the Log entry', () => {
    useSessionStore.getState().setHistory([sampleSession('s1')]);
    useSessionStore.getState().setFeedback('s1', false, 'Wrong position');

    const updated = useSessionStore.getState().history[0];
    expect(updated?.thumbsUp).toBe(false);
    expect(updated?.feedbackReason).toBe('Wrong position');
  });
});
