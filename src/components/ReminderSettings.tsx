import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import {
  applyReminderPrefs,
  formatReminderTime,
  hasNotificationPermission,
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
    const days = prefs.days.includes(day)
      ? prefs.days.filter((d) => d !== day)
      : [...prefs.days, day].sort((a, b) => a - b);
    await commit({ ...prefs, days });
  };

  const shiftHour = async (delta: number) => {
    await commit({ ...prefs, hour: (prefs.hour + delta + 24) % 24 });
  };
  const shiftMinute = async (delta: number) => {
    await commit({ ...prefs, minute: (prefs.minute + delta + 60) % 60 });
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
          Notifications are off for Flowlog. Enable them in your device settings,
          then toggle this on again.
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
