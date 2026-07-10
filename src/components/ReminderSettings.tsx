import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import {
  applyReminderPrefs,
  formatReminderTime,
  hasNotificationPermission,
  reminderTimeForDay,
  requestNotificationPermission,
} from '@/services/NotificationService';
import { useUserStore } from '@/store/userStore';
import {
  DAY_LABELS,
  DAY_NAMES,
  type ReminderPrefs,
} from '@/types/notifications';

/**
 * Reminder preferences for Profile: enable/disable, pick training days + time.
 * Every change cancels and reschedules through NotificationService, so the OS
 * schedule always matches what's on screen with no duplicates. Permission is
 * requested only after the user has read the priming rationale and tapped
 * "Allow reminders".
 */
export function ReminderSettings() {
  const prefs = useUserStore((s) => s.reminderPrefs);
  const setReminderPrefs = useUserStore((s) => s.setReminderPrefs);
  const [priming, setPriming] = useState(false);
  const [denied, setDenied] = useState(false);

  // Persist + (re)schedule, then reflect the effective prefs back into the store.
  const commit = async (next: ReminderPrefs) => {
    const effective = await applyReminderPrefs(next);
    setReminderPrefs(effective);
    return effective;
  };

  const onToggle = async (value: boolean) => {
    setDenied(false);
    if (!value) {
      await commit({ ...prefs, enabled: false });
      setPriming(false);
      return;
    }
    // Turning on: show the rationale first unless permission is already granted.
    if (await hasNotificationPermission()) {
      await commit({ ...prefs, enabled: true });
    } else {
      setPriming(true);
    }
  };

  const allowFromPriming = async () => {
    const granted = await requestNotificationPermission();
    setPriming(false);
    if (granted) {
      await commit({ ...prefs, enabled: true });
    } else {
      setDenied(true);
    }
  };

  const toggleDay = async (day: number) => {
    const adding = !prefs.days.includes(day);
    const days = adding
      ? [...prefs.days, day].sort((a, b) => a - b)
      : prefs.days.filter((d) => d !== day);
    // In advanced mode a newly-added day starts at the base time, editable
    // immediately via its own row.
    const dayTimes =
      adding && prefs.perDayTimes && !prefs.dayTimes[day]
        ? {
            ...prefs.dayTimes,
            [day]: { hour: prefs.hour, minute: prefs.minute },
          }
        : prefs.dayTimes;
    await commit({ ...prefs, days, dayTimes });
  };

  const shiftHour = async (delta: number) => {
    await commit({ ...prefs, hour: (prefs.hour + delta + 24) % 24 });
  };
  const shiftMinute = async (delta: number) => {
    await commit({ ...prefs, minute: (prefs.minute + delta + 60) % 60 });
  };

  // Advanced mode: turning it on seeds every selected day with the base time
  // (only days without an existing override), so nothing visibly changes until
  // the user edits a specific day. Turning it off keeps the overrides around,
  // inert, so toggling back restores them.
  const togglePerDayTimes = async (value: boolean) => {
    if (!value) {
      await commit({ ...prefs, perDayTimes: false });
      return;
    }
    const dayTimes = { ...prefs.dayTimes };
    for (const day of prefs.days) {
      dayTimes[day] ??= { hour: prefs.hour, minute: prefs.minute };
    }
    await commit({ ...prefs, perDayTimes: true, dayTimes });
  };

  const shiftDayTime = async (
    day: number,
    field: 'hour' | 'minute',
    delta: number,
  ) => {
    const current = reminderTimeForDay(prefs, day);
    const next =
      field === 'hour'
        ? { ...current, hour: (current.hour + delta + 24) % 24 }
        : { ...current, minute: (current.minute + delta + 60) % 60 };
    await commit({
      ...prefs,
      dayTimes: { ...prefs.dayTimes, [day]: next },
    });
  };

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="caption">REMINDERS</Text>
        <Switch
          testID="reminder-toggle"
          value={prefs.enabled}
          onValueChange={(v) => void onToggle(v)}
        />
      </View>

      {priming ? (
        <Card className="gap-3 border border-accent">
          <Text variant="body">Get a nudge after training</Text>
          <Text variant="caption">
            We’ll send a local reminder on your training days so you reflect
            while it’s fresh. No account or internet needed — it never leaves
            your phone.
          </Text>
          <Button
            testID="reminder-prime-allow"
            title="Allow reminders"
            onPress={() => void allowFromPriming()}
          />
        </Card>
      ) : null}

      {denied ? (
        <Text variant="caption" className="text-accent">
          Notifications are off for Flowlog. Enable them in your device
          settings, then toggle this on again.
        </Text>
      ) : null}

      {prefs.enabled ? (
        <Card className="gap-4">
          <View className="gap-2">
            <Text variant="caption">DAYS</Text>
            <View className="flex-row justify-between">
              {DAY_LABELS.map((label, day) => {
                const selected = prefs.days.includes(day);
                return (
                  <Pressable
                    key={day}
                    testID={`reminder-day-${day}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={DAY_NAMES[day]}
                    onPress={() => void toggleDay(day)}
                    className={`h-11 w-11 items-center justify-center rounded-full border ${
                      selected
                        ? 'border-primary bg-primary/20'
                        : 'border-muted bg-surface'
                    }`}
                  >
                    <Text variant="body">{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text variant="body">Different time per day</Text>
              <Text variant="caption">
                Set each training day’s own reminder time.
              </Text>
            </View>
            <Switch
              testID="reminder-per-day-toggle"
              value={prefs.perDayTimes}
              onValueChange={(v) => void togglePerDayTimes(v)}
            />
          </View>

          {!prefs.perDayTimes ? (
            <View className="gap-2">
              <Text variant="caption">TIME</Text>
              <View className="flex-row items-center justify-between">
                <Stepper
                  testIDDec="reminder-hour-dec"
                  testIDInc="reminder-hour-inc"
                  labelDec="Earlier hour"
                  labelInc="Later hour"
                  onDec={() => void shiftHour(-1)}
                  onInc={() => void shiftHour(1)}
                />
                <Text variant="heading">
                  {formatReminderTime(prefs.hour, prefs.minute)}
                </Text>
                <Stepper
                  testIDDec="reminder-min-dec"
                  testIDInc="reminder-min-inc"
                  labelDec="Earlier minutes"
                  labelInc="Later minutes"
                  onDec={() => void shiftMinute(-15)}
                  onInc={() => void shiftMinute(15)}
                />
              </View>
            </View>
          ) : (
            <View className="gap-3">
              <Text variant="caption">TIME PER DAY</Text>
              {prefs.days.map((day) => {
                const time = reminderTimeForDay(prefs, day);
                return (
                  <View key={day} className="gap-1">
                    <Text variant="caption">{DAY_NAMES[day]}</Text>
                    <View className="flex-row items-center justify-between">
                      <Stepper
                        testIDDec={`reminder-day-${day}-hour-dec`}
                        testIDInc={`reminder-day-${day}-hour-inc`}
                        labelDec={`${DAY_NAMES[day]} earlier hour`}
                        labelInc={`${DAY_NAMES[day]} later hour`}
                        onDec={() => void shiftDayTime(day, 'hour', -1)}
                        onInc={() => void shiftDayTime(day, 'hour', 1)}
                      />
                      <Text variant="heading">
                        {formatReminderTime(time.hour, time.minute)}
                      </Text>
                      <Stepper
                        testIDDec={`reminder-day-${day}-min-dec`}
                        testIDInc={`reminder-day-${day}-min-inc`}
                        labelDec={`${DAY_NAMES[day]} earlier minutes`}
                        labelInc={`${DAY_NAMES[day]} later minutes`}
                        onDec={() => void shiftDayTime(day, 'minute', -15)}
                        onInc={() => void shiftDayTime(day, 'minute', 15)}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {prefs.days.length === 0 ? (
            <Text variant="caption" className="text-accent">
              Pick at least one day to get reminders.
            </Text>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

function Stepper({
  testIDDec,
  testIDInc,
  labelDec,
  labelInc,
  onDec,
  onInc,
}: {
  testIDDec: string;
  testIDInc: string;
  labelDec: string;
  labelInc: string;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <View className="flex-row gap-2">
      <Pressable
        testID={testIDDec}
        accessibilityRole="button"
        accessibilityLabel={labelDec}
        onPress={onDec}
        className="h-11 w-11 items-center justify-center rounded-full bg-surface"
      >
        <Text variant="heading">–</Text>
      </Pressable>
      <Pressable
        testID={testIDInc}
        accessibilityRole="button"
        accessibilityLabel={labelInc}
        onPress={onInc}
        className="h-11 w-11 items-center justify-center rounded-full bg-surface"
      >
        <Text variant="heading">+</Text>
      </Pressable>
    </View>
  );
}
