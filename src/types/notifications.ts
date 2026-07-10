/** A 24-hour local wall-clock time. */
export interface DayTime {
  hour: number;
  minute: number;
}

/**
 * User preferences for local post-training reminder notifications. Days follow
 * the JavaScript `Date.getDay()` convention (0 = Sunday … 6 = Saturday). Time is
 * stored as 24-hour `hour` + `minute` in the device's local time.
 *
 * Two time modes: by default every selected day fires at the single
 * `hour`/`minute`. With `perDayTimes` on (the "different time per day"
 * advanced mode, e.g. Mon/Wed 8:30 PM but Sat 12 PM), each selected day uses
 * its `dayTimes` entry, falling back to `hour`/`minute` for days without one.
 * Both new fields default such that previously-persisted prefs (which predate
 * them) keep their exact old behaviour.
 */
export interface ReminderPrefs {
  enabled: boolean;
  /** Weekdays to remind on, 0–6 (Sun–Sat). */
  days: number[];
  hour: number;
  minute: number;
  /** Advanced mode: each selected day can have its own time. */
  perDayTimes: boolean;
  /** Per-day time overrides, keyed by weekday 0–6. */
  dayTimes: Partial<Record<number, DayTime>>;
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  enabled: false,
  days: [1, 3, 5], // Mon / Wed / Fri
  hour: 20,
  minute: 30,
  perDayTimes: false,
  dayTimes: {},
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
