import { groupSessionsByWeek } from '@/utils/groupSessionsByWeek';
import type { Session } from '@/types/session';

function session(id: string, date: string): Session {
  return {
    id,
    userId: 'u',
    sportKey: 'bjj',
    sessionDate: `${date}T12:00:00.000Z`,
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
    createdAt: `${date}T12:00:00.000Z`,
  };
}

describe('groupSessionsByWeek', () => {
  // Monday 2026-06-15 — deterministic "now".
  const now = new Date(2026, 5, 15);

  it('groups into week sections, newest week and session first', () => {
    const sections = groupSessionsByWeek(
      [
        session('a', '2026-06-16'), // this week
        session('b', '2026-06-15'), // this week (older)
        session('c', '2026-06-10'), // last week
        session('d', '2026-06-02'), // two weeks ago
      ],
      now,
    );

    expect(sections.map((s) => s.title)).toEqual([
      'This week',
      'Last week',
      'Week of Jun 1',
    ]);
    // Newest-first within the first week.
    expect(sections[0]?.data.map((s) => s.id)).toEqual(['a', 'b']);
    expect(sections[1]?.data.map((s) => s.id)).toEqual(['c']);
    expect(sections[2]?.data.map((s) => s.id)).toEqual(['d']);
  });

  it('returns no sections for an empty list', () => {
    expect(groupSessionsByWeek([], now)).toEqual([]);
  });
});
