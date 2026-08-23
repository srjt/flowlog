import { computeTrends } from '@/services/TrendsService';
import type { Session } from '@/types/session';

function session(overrides: Partial<Session>): Session {
  return {
    id: Math.random().toString(36).slice(2),
    userId: 'u1',
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
    pipelineVersion: 'test',
    createdAt: '2026-06-10T10:00:00.000Z',
    ...overrides,
  };
}

describe('computeTrends', () => {
  it('returns empty trends for no sessions', () => {
    const t = computeTrends([]);
    expect(t.sessionCount).toBe(0);
    expect(t.streakDays).toBe(0);
    expect(t.focusArea).toBeNull();
    expect(t.lastSessionAt).toBeNull();
    expect(t.thumbsUpRate).toBeNull();
  });

  it('counts sessions and finds the most frequent position as focus area', () => {
    const t = computeTrends([
      session({ positionsVisited: ['Guard', 'Mount'] }),
      session({ positionsVisited: ['Guard'] }),
      session({ positionsVisited: ['Back Control'] }),
    ]);
    expect(t.sessionCount).toBe(3);
    expect(t.focusArea).toBe('Guard');
    expect(t.topPositions[0]).toEqual({ label: 'Guard', count: 2 });
  });

  it('computes a consecutive-day streak ending at the latest session', () => {
    const t = computeTrends([
      session({ sessionDate: '2026-06-12T09:00:00.000Z' }),
      session({ sessionDate: '2026-06-11T09:00:00.000Z' }),
      session({ sessionDate: '2026-06-10T09:00:00.000Z' }),
      // gap (no 06-09)
      session({ sessionDate: '2026-06-07T09:00:00.000Z' }),
    ]);
    expect(t.streakDays).toBe(3);
    expect(t.lastSessionAt).toBe('2026-06-12T09:00:00.000Z');
  });

  it('dedupes recent mistakes (newest first) and tallies mood', () => {
    const t = computeTrends([
      session({
        sessionDate: '2026-06-12T09:00:00.000Z',
        keyMistake: 'Exposed neck in turtle',
        sentiment: 'flat',
      }),
      session({
        sessionDate: '2026-06-11T09:00:00.000Z',
        keyMistake: 'Exposed neck in turtle',
        sentiment: 'encouraged',
      }),
      session({
        sessionDate: '2026-06-10T09:00:00.000Z',
        keyMistake: 'Passed too upright',
        sentiment: 'flat',
      }),
    ]);
    expect(t.recentMistakes).toEqual([
      'Exposed neck in turtle',
      'Passed too upright',
    ]);
    expect(t.moodBreakdown[0]).toEqual({ label: 'flat', count: 2 });
  });

  it('computes thumbs-up rate over rated sessions only', () => {
    const t = computeTrends([
      session({ thumbsUp: true }),
      session({ thumbsUp: false }),
      session({ thumbsUp: true }),
      session({ thumbsUp: null }),
    ]);
    expect(t.thumbsUpRate).toBeCloseTo(2 / 3);
  });
});
