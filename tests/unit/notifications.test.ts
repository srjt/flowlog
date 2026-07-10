import * as Notifications from 'expo-notifications';

import {
  applyDigestPrefs,
  applyReminderPrefs,
  buildDigestBody,
  formatReminderTime,
  reminderTimeForDay,
} from '@/services/NotificationService';
import type { SportTrends } from '@/services/TrendsService';
import {
  DEFAULT_REMINDER_PREFS,
  type ReminderPrefs,
} from '@/types/notifications';

const sched = Notifications.scheduleNotificationAsync as jest.Mock;
const cancelOne = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const getPerm = Notifications.getPermissionsAsync as jest.Mock;

function trends(partial: Partial<SportTrends> = {}): SportTrends {
  return {
    sessionCount: 5,
    streakDays: 2,
    lastSessionAt: '2026-06-14T10:00:00.000Z',
    focusArea: 'Guard',
    topPositions: [{ label: 'Guard', count: 3 }],
    recentMistakes: ['hand placement', 'flat hips'],
    moodBreakdown: [],
    thumbsUpRate: null,
    ...partial,
  };
}

describe('NotificationService — reminders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPerm.mockResolvedValue({ granted: true });
  });

  it('schedules one stable-identifier weekly trigger per day, cancelling reminder ids first', async () => {
    const effective = await applyReminderPrefs({
      ...DEFAULT_REMINDER_PREFS,
      enabled: true,
      days: [1, 3, 5],
      hour: 20,
      minute: 30,
    });

    // Cancels every reminder identifier (0–6), never a blanket cancel.
    expect(cancelOne).toHaveBeenCalledTimes(7);
    expect(sched).toHaveBeenCalledTimes(3);
    const calls = sched.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.identifier)).toEqual([
      'flowlog-reminder-1',
      'flowlog-reminder-3',
      'flowlog-reminder-5',
    ]);
    expect(calls[0].trigger).toEqual({
      type: 'calendar',
      weekday: 2,
      hour: 20,
      minute: 30,
      repeats: true,
    });
    expect(calls[0].content.data).toEqual({ url: '/(tabs)/record' });
    expect(effective.enabled).toBe(true);
  });

  it('schedules each day at its own time in advanced (per-day) mode', async () => {
    // The user's real schedule: Mon/Wed 8:30 PM, Sat 12 PM, Sun 11 AM.
    await applyReminderPrefs({
      ...DEFAULT_REMINDER_PREFS,
      enabled: true,
      days: [0, 1, 3, 6],
      hour: 20,
      minute: 30,
      perDayTimes: true,
      dayTimes: {
        0: { hour: 11, minute: 0 },
        6: { hour: 12, minute: 0 },
      },
    });

    expect(sched).toHaveBeenCalledTimes(4);
    const byDay = Object.fromEntries(
      sched.mock.calls.map((c) => [c[0].identifier, c[0].trigger]),
    );
    // Days with an override use it; Mon/Wed fall back to the base time.
    expect(byDay['flowlog-reminder-0']).toMatchObject({ hour: 11, minute: 0 });
    expect(byDay['flowlog-reminder-6']).toMatchObject({ hour: 12, minute: 0 });
    expect(byDay['flowlog-reminder-1']).toMatchObject({ hour: 20, minute: 30 });
    expect(byDay['flowlog-reminder-3']).toMatchObject({ hour: 20, minute: 30 });
  });

  it('ignores stale per-day overrides when advanced mode is off', async () => {
    await applyReminderPrefs({
      ...DEFAULT_REMINDER_PREFS,
      enabled: true,
      days: [2],
      hour: 7,
      minute: 15,
      perDayTimes: false,
      dayTimes: { 2: { hour: 23, minute: 45 } },
    });
    expect(sched.mock.calls[0][0].trigger).toMatchObject({
      hour: 7,
      minute: 15,
    });
  });

  it('reschedules without duplicates across applies', async () => {
    await applyReminderPrefs({
      ...DEFAULT_REMINDER_PREFS,
      enabled: true,
      days: [1],
      hour: 8,
      minute: 0,
    });
    await applyReminderPrefs({
      ...DEFAULT_REMINDER_PREFS,
      enabled: true,
      days: [2],
      hour: 8,
      minute: 0,
    });
    expect(cancelOne).toHaveBeenCalledTimes(14); // 7 per apply
    expect(sched).toHaveBeenCalledTimes(2);
  });

  it('forces enabled off and schedules nothing without permission', async () => {
    getPerm.mockResolvedValue({ granted: false });
    const effective = await applyReminderPrefs({
      ...DEFAULT_REMINDER_PREFS,
      enabled: true,
      days: [1, 3],
      hour: 19,
      minute: 0,
    });
    expect(effective.enabled).toBe(false);
    expect(sched).not.toHaveBeenCalled();
  });

  it('resolves per-day times with base-time fallback (shared UI/scheduler helper)', () => {
    const prefs: ReminderPrefs = {
      ...DEFAULT_REMINDER_PREFS,
      hour: 20,
      minute: 30,
      perDayTimes: true,
      dayTimes: { 6: { hour: 12, minute: 0 } },
    };
    expect(reminderTimeForDay(prefs, 6)).toEqual({ hour: 12, minute: 0 });
    expect(reminderTimeForDay(prefs, 1)).toEqual({ hour: 20, minute: 30 });
    expect(reminderTimeForDay({ ...prefs, perDayTimes: false }, 6)).toEqual({
      hour: 20,
      minute: 30,
    });
  });

  it('disabling schedules nothing', async () => {
    await applyReminderPrefs({ ...DEFAULT_REMINDER_PREFS, enabled: false });
    expect(sched).not.toHaveBeenCalled();
  });

  it('formats reminder time in 12-hour clock', () => {
    expect(formatReminderTime(20, 30)).toBe('8:30 PM');
    expect(formatReminderTime(0, 5)).toBe('12:05 AM');
    expect(formatReminderTime(12, 0)).toBe('12:00 PM');
  });
});

describe('NotificationService — weekly digest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPerm.mockResolvedValue({ granted: true });
  });

  it('builds a body from TrendsService output', () => {
    expect(buildDigestBody(trends())).toBe(
      'Most-worked: Guard. Recurring leak: hand placement.',
    );
  });

  it('schedules one weekly digest opening Trends, with the summary baked in', async () => {
    await applyDigestPrefs(
      { enabled: true, day: 0, hour: 18, minute: 0 },
      trends(),
    );
    expect(cancelOne).toHaveBeenCalledWith('flowlog-digest');
    expect(sched).toHaveBeenCalledTimes(1);
    const call = sched.mock.calls[0][0];
    expect(call.identifier).toBe('flowlog-digest');
    expect(call.trigger).toEqual({
      type: 'calendar',
      weekday: 1,
      hour: 18,
      minute: 0,
      repeats: true,
    });
    expect(call.content.data).toEqual({ url: '/(tabs)/trends' });
    expect(call.content.body).toContain('Most-worked: Guard');
  });

  it('schedules nothing when there are no sessions to summarize', async () => {
    await applyDigestPrefs(
      { enabled: true, day: 0, hour: 18, minute: 0 },
      trends({ sessionCount: 0 }),
    );
    expect(sched).not.toHaveBeenCalled();
  });
});
