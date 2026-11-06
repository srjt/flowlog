import {
  computeTrends,
  WEAKNESS_MIN_RECURRENCE,
  WEAKNESS_WINDOW,
} from '@/services/TrendsService';
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
    gi: null,
    giSource: null,
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

describe('computeTrends — recurring Weakness (#1)', () => {
  /** A session on 2026-06-<day>, so ordering is unambiguous. */
  function on(day: number, overrides: Partial<Session> = {}): Session {
    const date = `2026-06-${String(day).padStart(2, '0')}T10:00:00.000Z`;
    return session({ sessionDate: date, createdAt: date, ...overrides });
  }
  function mistakeAt(
    day: number,
    positionId: string | null,
    keyMistake: string | null,
    label?: string,
  ): Session {
    return on(day, {
      targetPositionId: positionId,
      targetPosition: label ?? positionId,
      keyMistake,
    });
  }

  it('is null with no sessions', () => {
    expect(computeTrends([]).weakness).toBeNull();
  });

  it('is null when no position has carried the key mistake twice', () => {
    const t = computeTrends([
      mistakeAt(1, 'mount-bottom', 'stayed flat'),
      mistakeAt(2, 'half-guard-bottom', 'lost the underhook'),
      mistakeAt(3, 'side-control-bottom', 'no frames'),
    ]);
    expect(t.weakness).toBeNull();
  });

  it('names the position the key mistake keeps landing on, with its evidence', () => {
    const t = computeTrends([
      mistakeAt(
        1,
        'half-guard-bottom',
        'lost the underhook',
        'Half guard (bottom)',
      ),
      mistakeAt(2, 'mount-bottom', 'stayed flat', 'Mount (bottom)'),
      mistakeAt(
        3,
        'half-guard-bottom',
        'got flattened out',
        'Half guard (bottom)',
      ),
      mistakeAt(
        4,
        'half-guard-bottom',
        'no knee shield',
        'Half guard (bottom)',
      ),
    ]);
    expect(t.weakness).toEqual({
      positionId: 'half-guard-bottom',
      label: 'Half guard (bottom)',
      count: 3,
      window: 4,
      latestMistake: 'no knee shield', // the most recent, not the first
    });
  });

  it('is not the Focus area: most-logged and most-troublesome can differ', () => {
    const t = computeTrends([
      on(1, {
        positionsVisited: ['Closed Guard'],
        targetPositionId: 'mount-bottom',
        targetPosition: 'Mount (bottom)',
        keyMistake: 'stayed flat',
      }),
      on(2, {
        positionsVisited: ['Closed Guard'],
        targetPositionId: 'mount-bottom',
        targetPosition: 'Mount (bottom)',
        keyMistake: 'bridged too late',
      }),
      on(3, { positionsVisited: ['Closed Guard'] }),
    ]);
    expect(t.focusArea).toBe('Closed Guard');
    expect(t.weakness?.positionId).toBe('mount-bottom');
  });

  it('ignores Sessions that are not evidence about a position', () => {
    const t = computeTrends([
      // A submission mistake resolves to no canonical position (#116).
      mistakeAt(1, null, 'could not finish the triangle'),
      mistakeAt(2, null, 'could not finish the triangle'),
      // A declined Take, or a Session with a position but no mistake.
      mistakeAt(3, 'mount-bottom', null),
      mistakeAt(4, 'mount-bottom', '   '),
      mistakeAt(5, 'mount-bottom', 'stayed flat'),
    ]);
    expect(t.weakness).toBeNull(); // mount-bottom has only one real mistake
  });

  it('only weighs the most recent window, so a fixed problem drops out', () => {
    const old = [
      mistakeAt(1, 'back-mount-bottom', 'hands down'),
      mistakeAt(2, 'back-mount-bottom', 'hands down'),
      mistakeAt(3, 'back-mount-bottom', 'hands down'),
    ];
    const recent = Array.from({ length: WEAKNESS_WINDOW }, (_, i) =>
      mistakeAt(10 + i, `position-${i}`, `mistake ${i}`),
    );
    const t = computeTrends([...old, ...recent]);
    expect(t.weakness).toBeNull();

    // One more recurrence inside the window and it comes back.
    const t2 = computeTrends([
      ...old,
      ...recent.slice(1),
      mistakeAt(25, 'back-mount-bottom', 'hands down again'),
      mistakeAt(26, 'back-mount-bottom', 'hands down again'),
    ]);
    expect(t2.weakness?.positionId).toBe('back-mount-bottom');
    expect(t2.weakness?.count).toBe(2);
    expect(t2.weakness?.window).toBe(WEAKNESS_WINDOW);
  });

  it('breaks a tie toward the position whose mistake is most recent', () => {
    const t = computeTrends([
      mistakeAt(1, 'mount-bottom', 'a'),
      mistakeAt(2, 'half-guard-bottom', 'b'),
      mistakeAt(3, 'mount-bottom', 'c'),
      mistakeAt(4, 'half-guard-bottom', 'd'),
    ]);
    expect(t.weakness?.positionId).toBe('half-guard-bottom');
  });

  it('falls back to the position id when no label was stored', () => {
    const t = computeTrends([
      on(1, {
        targetPositionId: 'mount-bottom',
        targetPosition: null,
        keyMistake: 'x',
      }),
      on(2, {
        targetPositionId: 'mount-bottom',
        targetPosition: null,
        keyMistake: 'y',
      }),
    ]);
    expect(t.weakness?.label).toBe('mount-bottom');
  });

  it(`calls exactly ${WEAKNESS_MIN_RECURRENCE} occurrences recurring`, () => {
    const sessions = Array.from({ length: WEAKNESS_MIN_RECURRENCE }, (_, i) =>
      mistakeAt(i + 1, 'mount-bottom', `m${i}`),
    );
    expect(computeTrends(sessions).weakness?.count).toBe(
      WEAKNESS_MIN_RECURRENCE,
    );
    expect(computeTrends(sessions.slice(1)).weakness).toBeNull();
  });
});
