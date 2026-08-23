import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import {
  applyDigestPrefsWithHistory,
  buildWeeklyDigest,
  loadDigestHistory,
  materializeDueDigests,
  persistDigestHistory,
  syncDigestHistory,
  type WeeklyDigest,
} from '@/services/DigestService';
import { buildDigestBody } from '@/services/NotificationService';
import { computeTrends, type SportTrends } from '@/services/TrendsService';
import type { Session } from '@/types/session';

let seq = 0;
function session(overrides: Partial<Session> = {}): Session {
  seq += 1;
  return {
    id: `s${seq}`,
    userId: 'u1',
    sportKey: 'bjj',
    sessionDate: '2026-06-10T12:00:00.000Z',
    audioStoragePath: null,
    rawTranscript: null,
    positionsVisited: ['Guard'],
    keyMistake: 'flat hips',
    opponentAction: null,
    sentiment: null,
    coachingCue: null,
    targetPosition: null,
    targetPositionId: null,
    qualityGatePassed: true,
    thumbsUp: null,
    pipelineVersion: null,
    createdAt: '2026-06-10T12:00:00.000Z',
    ...overrides,
  };
}

function trends(partial: Partial<SportTrends> = {}): SportTrends {
  return {
    sessionCount: 3,
    streakDays: 1,
    lastSessionAt: '2026-06-10T12:00:00.000Z',
    focusArea: 'Guard',
    topPositions: [{ label: 'Guard', count: 3 }],
    recentMistakes: ['flat hips', 'hand placement'],
    moodBreakdown: [],
    thumbsUpRate: null,
    ...partial,
  };
}

describe('DigestService — buildWeeklyDigest', () => {
  it('mirrors TrendsService output: focus, leak, and identical body', () => {
    const t = trends();
    const digest = buildWeeklyDigest(t, '2026-06-08', 'bjj');
    expect(digest).toEqual({
      id: 'bjj-2026-06-08',
      weekStart: '2026-06-08',
      sport: 'bjj',
      focusArea: 'Guard',
      recurringLeak: 'flat hips',
      body: buildDigestBody(t),
    });
  });

  it('carries nulls through when a week has no positions or mistakes', () => {
    const digest = buildWeeklyDigest(
      trends({ focusArea: null, recentMistakes: [] }),
      '2026-06-08',
      'bjj',
    );
    expect(digest.focusArea).toBeNull();
    expect(digest.recurringLeak).toBeNull();
  });
});

describe('DigestService — materializeDueDigests', () => {
  const now = new Date('2026-06-25T12:00:00.000Z');

  it('captures a snapshot for a newly-elapsed active week', () => {
    const sessions = [
      session({ positionsVisited: ['Mount'], keyMistake: 'slow escape' }),
      session({ positionsVisited: ['Mount'], keyMistake: 'slow escape' }),
      session({ positionsVisited: ['Guard'], keyMistake: 'flat hips' }),
    ];
    const out = materializeDueDigests(sessions, now, []);
    expect(out).toHaveLength(1);
    const [d] = out;
    const t = computeTrends(sessions);
    expect(d?.focusArea).toBe('Mount'); // most-worked that week
    expect(d?.recurringLeak).toBe(t.recentMistakes[0]);
    expect(d?.body).toBe(buildDigestBody(t));
    expect(d?.sport).toBe('bjj');
  });

  it('is idempotent — re-running over its own output adds nothing', () => {
    const sessions = [session(), session()];
    const first = materializeDueDigests(sessions, now, []);
    const second = materializeDueDigests(sessions, now, first);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('fills multiple missed weeks, newest first', () => {
    const sessions = [
      session({ sessionDate: '2026-06-03T12:00:00.000Z' }), // week A
      session({ sessionDate: '2026-06-10T12:00:00.000Z' }), // week B
      session({ sessionDate: '2026-06-17T12:00:00.000Z' }), // week C
    ];
    const out = materializeDueDigests(sessions, now, []);
    expect(out).toHaveLength(3);
    // Sorted by week-start descending (no reliance on exact TZ-shifted keys).
    const weekStarts = out.map((d) => d.weekStart);
    expect(weekStarts).toEqual([...weekStarts].sort().reverse());
  });

  it('excludes the in-progress current week', () => {
    // Session dated the same day as `now` — its week has not elapsed yet.
    const sessions = [session({ sessionDate: now.toISOString() })];
    expect(materializeDueDigests(sessions, now, [])).toEqual([]);
  });

  it('produces nothing when there is no activity', () => {
    expect(materializeDueDigests([], now, [])).toEqual([]);
  });

  it('preserves existing history it did not need to touch', () => {
    const prior: WeeklyDigest = {
      id: 'bjj-2026-05-25',
      weekStart: '2026-05-25',
      sport: 'bjj',
      focusArea: 'Side control',
      recurringLeak: 'no frames',
      body: 'old body',
    };
    const sessions = [session({ sessionDate: '2026-06-10T12:00:00.000Z' })];
    const out = materializeDueDigests(sessions, now, [prior]);
    expect(out).toHaveLength(2);
    expect(out.find((d) => d.id === prior.id)).toEqual(prior);
  });
});

describe('DigestService — persistence round-trip', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns an empty history before anything is stored', async () => {
    expect(await loadDigestHistory()).toEqual([]);
  });

  it('persists and reloads the same history', async () => {
    const sessions = [session(), session()];
    const built = materializeDueDigests(
      sessions,
      new Date('2026-06-25T12:00:00.000Z'),
      [],
    );
    await persistDigestHistory(built);
    expect(await loadDigestHistory()).toEqual(built);
  });

  it('syncDigestHistory materializes, persists, and is stable on re-run', async () => {
    const sessions = [session(), session()];
    const now = new Date('2026-06-25T12:00:00.000Z');
    const first = await syncDigestHistory(sessions, now);
    expect(first).toHaveLength(1);
    expect(await loadDigestHistory()).toEqual(first);

    const second = await syncDigestHistory(sessions, now);
    expect(second).toEqual(first);
  });
});

describe('DigestService — applyDigestPrefsWithHistory', () => {
  const sched = Notifications.scheduleNotificationAsync as jest.Mock;
  const now = new Date('2026-06-25T12:00:00.000Z');

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
    });
  });

  it('bakes the latest stored digest body into the scheduled notification', async () => {
    const sessions = [
      session({ positionsVisited: ['Mount'], keyMistake: 'slow escape' }),
      session({ positionsVisited: ['Mount'], keyMistake: 'slow escape' }),
    ];
    const { prefs, history } = await applyDigestPrefsWithHistory(
      { enabled: true, day: 0, hour: 18, minute: 0 },
      sessions,
      now,
    );

    expect(prefs.enabled).toBe(true);
    expect(history).toHaveLength(1);
    // The banner text matches the /digest page the user will open.
    const call = sched.mock.calls[0][0];
    expect(call.content.body).toBe(history[0]?.body);
    expect(call.content.data).toEqual({ url: '/digest' });
  });

  it('falls back to live-trends body when no week has elapsed yet', async () => {
    // Only in-progress-week activity — nothing materialized, so no aligned body.
    const sessions = [session({ sessionDate: now.toISOString() })];
    const { history } = await applyDigestPrefsWithHistory(
      { enabled: true, day: 0, hour: 18, minute: 0 },
      sessions,
      now,
    );
    expect(history).toHaveLength(0);
    expect(sched.mock.calls[0][0].content.body).toContain('Most-worked');
  });
});
