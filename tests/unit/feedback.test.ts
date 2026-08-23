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
    targetPositionId: null,
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
    targetPositionId: null,
    qualityGatePassed: true,
    thumbsUp: null,
    pipelineVersion: null,
    createdAt: '2026-06-10T10:00:00.000Z',
  };
}

describe('feedback reason + note', () => {
  it('saveSessionFeedback persists 👎 with a reason and note, 👍 with neither, and an optional note', async () => {
    const a = await localTestStorage.saveSession(newSession('uA'));
    const b = await localTestStorage.saveSession(newSession('uB'));
    const c = await localTestStorage.saveSession(newSession('uC'));

    // 👎 with both a category and a free-text note.
    await saveSessionFeedback(
      a.id,
      false,
      'Too generic',
      'It ignored the half-guard sweep I described.',
    );
    // 👍 persists no reason and no note.
    await saveSessionFeedback(b.id, true);
    // 👎 with a category but no note — note stays null (optional).
    await saveSessionFeedback(c.id, false, 'Wrong position');

    const la = await localTestStorage.listSessions('uA');
    const lb = await localTestStorage.listSessions('uB');
    const lc = await localTestStorage.listSessions('uC');
    expect(la[0]?.thumbsUp).toBe(false);
    expect(la[0]?.feedbackReason).toBe('Too generic');
    expect(la[0]?.feedbackNote).toBe(
      'It ignored the half-guard sweep I described.',
    );
    expect(lb[0]?.thumbsUp).toBe(true);
    expect(lb[0]?.feedbackReason).toBeNull();
    expect(lb[0]?.feedbackNote).toBeNull();
    expect(lc[0]?.feedbackReason).toBe('Wrong position');
    expect(lc[0]?.feedbackNote).toBeNull();
  });

  it('store.setFeedback records the thumb, reason, and note on the Log entry', () => {
    useSessionStore.getState().setHistory([sampleSession('s1')]);
    useSessionStore
      .getState()
      .setFeedback(
        's1',
        false,
        'Wrong position',
        'Should have said frame first.',
      );

    const updated = useSessionStore.getState().history[0];
    expect(updated?.thumbsUp).toBe(false);
    expect(updated?.feedbackReason).toBe('Wrong position');
    expect(updated?.feedbackNote).toBe('Should have said frame first.');
  });
});
