/**
 * User preferences for local post-training reminder notifications. Days follow
 * the JavaScript `Date.getDay()` convention (0 = Sunday … 6 = Saturday). Time is
 * stored as 24-hour `hour` + `minute` in the device's local time.
 */
export interface ReminderPrefs {
  enabled: boolean;
  /** Weekdays to remind on, 0–6 (Sun–Sat). */
  days: number[];
  hour: number;
  minute: number;
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  enabled: false,
  days: [1, 3, 5], // Mon / Wed / Fri
  hour: 20,
  minute: 30,
};

/**
 * Weekly re-engagement digest: a single local notification summarizing the
 * week's focus area + recurring leak. `day` follows `Date.getDay()` (0–6).
 */
export interface DigestPrefs {
  enabled: boolean;
  day: number;
  hour: number;
  minute: number;
}

export const DEFAULT_DIGEST_PREFS: DigestPrefs = {
  enabled: false,
  day: 0, // Sunday
  hour: 18,
  minute: 0,
};

/** Short labels for the day chips, indexed by `Date.getDay()`. */
export const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** Full day names for accessibility labels, indexed by `Date.getDay()`. */
export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
