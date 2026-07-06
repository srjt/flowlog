import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { SportTrends } from '@/services/TrendsService';
import {
  DEFAULT_DIGEST_PREFS,
  DEFAULT_REMINDER_PREFS,
  type DigestPrefs,
  type ReminderPrefs,
} from '@/types/notifications';
import { logger } from '@/utils/logger';

const PREFS_KEY = 'flowlog.reminderPrefs.v1';
const DIGEST_KEY = 'flowlog.digestPrefs.v1';

/** Deep-link target tapped reminders open. Consumed in the root layout. */
export const REMINDER_ROUTE = '/(tabs)/record';
/** Deep-link target the weekly digest opens. */
export const DIGEST_ROUTE = '/(tabs)/trends';

// Stable notification identifiers so reminders and the digest can be cancelled
// independently (a blanket cancel would clobber the other feature's schedule).
const REMINDER_IDS = [0, 1, 2, 3, 4, 5, 6].map((d) => `flowlog-reminder-${d}`);
const DIGEST_ID = 'flowlog-digest';

/**
 * Local post-training reminders. Everything is LOCAL — no server push, no API
 * keys — so it works offline and ships nothing sensitive in the client.
 *
 * Web has no scheduled-notification support in Expo, so every method no-ops
 * there (the app runs web-only on some machines and must not crash). All
 * scheduling is owned here: callers change prefs, we cancel + reschedule so
 * there are never duplicate or stale reminders.
 */
function isSupported(): boolean {
  return Platform.OS !== 'web';
}

/** Foreground display behaviour. Safe to call on every app start. */
export function configureNotificationHandler(): void {
  if (!isSupported()) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      // SDK 54 split the old `shouldShowAlert` into banner + list.
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function loadReminderPrefs(): Promise<ReminderPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_REMINDER_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReminderPrefs>;
    return { ...DEFAULT_REMINDER_PREFS, ...parsed };
  } catch (err) {
    logger.warn('loadReminderPrefs failed', err);
    return DEFAULT_REMINDER_PREFS;
  }
}

async function persistPrefs(prefs: ReminderPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    logger.warn('persistReminderPrefs failed', err);
  }
}

export async function loadDigestPrefs(): Promise<DigestPrefs> {
  try {
    const raw = await AsyncStorage.getItem(DIGEST_KEY);
    if (!raw) return DEFAULT_DIGEST_PREFS;
    const parsed = JSON.parse(raw) as Partial<DigestPrefs>;
    return { ...DEFAULT_DIGEST_PREFS, ...parsed };
  } catch (err) {
    logger.warn('loadDigestPrefs failed', err);
    return DEFAULT_DIGEST_PREFS;
  }
}

async function persistDigestPrefs(prefs: DigestPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(DIGEST_KEY, JSON.stringify(prefs));
  } catch (err) {
    logger.warn('persistDigestPrefs failed', err);
  }
}

/** True if the OS already granted notification permission. */
export async function hasNotificationPermission(): Promise<boolean> {
  if (!isSupported()) return false;
  const { granted } = await Notifications.getPermissionsAsync();
  return granted;
}

/** Ask the OS for permission. Call AFTER showing the user a priming rationale. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isSupported()) return false;
  const { granted } = await Notifications.requestPermissionsAsync();
  return granted;
}

/**
 * Persist prefs and rebuild the schedule from scratch: cancel everything we
 * previously scheduled, then add one repeating weekly trigger per selected day.
 * Cancel-then-create guarantees no duplicates when prefs change. Returns the
 * prefs actually applied (with `enabled` forced false if permission is missing).
 */
export async function applyReminderPrefs(
  prefs: ReminderPrefs,
): Promise<ReminderPrefs> {
  if (!isSupported()) {
    await persistPrefs(prefs);
    return prefs;
  }

  // Cancel only the reminder identifiers (never the digest) so the two features
  // don't clobber each other, and rescheduling can't create duplicates.
  for (const id of REMINDER_IDS) {
    await Notifications.cancelScheduledNotificationAsync(id);
  }

  let effective = prefs;
  if (prefs.enabled) {
    const granted = await hasNotificationPermission();
    if (!granted) {
      effective = { ...prefs, enabled: false };
    } else {
      for (const day of prefs.days) {
        await Notifications.scheduleNotificationAsync({
          identifier: `flowlog-reminder-${day}`,
          content: {
            title: 'How was training?',
            body: '60 seconds to reflect while it’s fresh.',
            data: { url: REMINDER_ROUTE },
          },
          trigger: {
            // expo weekday is 1–7 (Sun–Sat); our prefs use 0–6 (Sun–Sat).
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            weekday: day + 1,
            hour: prefs.hour,
            minute: prefs.minute,
            repeats: true,
          },
        });
      }
    }
  }

  await persistPrefs(effective);
  return effective;
}

/** One-line summary for the weekly digest, derived from TrendsService output. */
export function buildDigestBody(trends: SportTrends): string {
  const focus = trends.focusArea ?? 'a bit of everything';
  const leak = trends.recentMistakes[0] ?? 'nothing flagged';
  return `Most-worked: ${focus}. Recurring leak: ${leak}.`;
}

/**
 * Persist digest prefs and (re)schedule the single weekly digest notification.
 * The body is baked from `trends` at schedule time (local notifications can't
 * recompute when they fire), so callers reschedule whenever trends change — e.g.
 * on the Trends screen. Returns the effective prefs (enabled forced false if
 * unsupported, permission missing, or there are no sessions yet to summarize).
 */
export async function applyDigestPrefs(
  prefs: DigestPrefs,
  trends: SportTrends | null,
): Promise<DigestPrefs> {
  if (!isSupported()) {
    await persistDigestPrefs(prefs);
    return prefs;
  }

  await Notifications.cancelScheduledNotificationAsync(DIGEST_ID);

  let effective = prefs;
  const hasData = (trends?.sessionCount ?? 0) > 0;
  if (prefs.enabled && hasData && (await hasNotificationPermission())) {
    await Notifications.scheduleNotificationAsync({
      identifier: DIGEST_ID,
      content: {
        title: 'Your week in review',
        body: buildDigestBody(trends as SportTrends),
        data: { url: DIGEST_ROUTE },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        weekday: prefs.day + 1,
        hour: prefs.hour,
        minute: prefs.minute,
        repeats: true,
      },
    });
  } else if (prefs.enabled && !hasData) {
    // Keep the user's intent, but there's nothing to summarize yet.
    effective = prefs;
  }

  await persistDigestPrefs(effective);
  return effective;
}

/**
 * Subscribe to notification taps. Invokes `onOpen` with the deep-link URL stored
 * on the notification so the app can route to Record. No-ops on web.
 */
export function addReminderResponseListener(
  onOpen: (url: string) => void,
): () => void {
  if (!isSupported()) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === 'string') onOpen(url);
    },
  );
  return () => sub.remove();
}

/** Deep-link URL if the app was cold-launched by tapping a reminder, else null. */
export async function getInitialReminderUrl(): Promise<string | null> {
  if (!isSupported()) return null;
  const response = await Notifications.getLastNotificationResponseAsync();
  const url = response?.notification.request.content.data?.url;
  return typeof url === 'string' ? url : null;
}

/** Format a 24h time as a friendly local string, e.g. "8:30 PM". */
export function formatReminderTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${minute.toString().padStart(2, '0')} ${period}`;
}
