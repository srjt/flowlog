import { Pressable, Switch, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import {
  applyDigestPrefs,
  formatReminderTime,
  hasNotificationPermission,
  requestNotificationPermission,
} from '@/services/NotificationService';
import { loadSessions } from '@/services/sessionsSource';
import { computeTrends } from '@/services/TrendsService';
import { useUserStore } from '@/store/userStore';
import {
  DAY_LABELS,
  DAY_NAMES,
  type DigestPrefs,
} from '@/types/notifications';
import { logger } from '@/utils/logger';

/**
 * Weekly digest preferences for Profile: a single re-engagement notification
 * summarizing the active sport's focus area + recurring leak (from
 * TrendsService). The summary is baked in at schedule time, so this recomputes
 * trends from the latest sessions whenever prefs change; the Trends screen also
 * reschedules on focus to keep the text fresh.
 */
export function DigestSettings() {
  const prefs = useUserStore((s) => s.digestPrefs);
  const setDigestPrefs = useUserStore((s) => s.setDigestPrefs);
  const { authUser, activeSport } = useUserStore();

  const commit = async (next: DigestPrefs) => {
    const sessions = await loadSessions(
      authUser?.id ?? 'demo-user',
      activeSport,
    );
    const trends = computeTrends(
      sessions.filter((s) => s.sportKey === activeSport),
    );
    const effective = await applyDigestPrefs(next, trends);
    setDigestPrefs(effective);
  };

  const onToggle = async (value: boolean) => {
    if (value && !(await hasNotificationPermission())) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        logger.warn('digest enable blocked: no notification permission');
        return;
      }
    }
    await commit({ ...prefs, enabled: value });
  };

  const setDay = async (day: number) => {
    await commit({ ...prefs, day });
  };
  const shiftHour = async (delta: number) => {
    await commit({ ...prefs, hour: (prefs.hour + delta + 24) % 24 });
  };

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="caption">WEEKLY DIGEST</Text>
        <Switch
          testID="digest-toggle"
          value={prefs.enabled}
          onValueChange={(v) => void onToggle(v)}
        />
      </View>
      <Text variant="caption">
        A once-a-week recap of your focus area and recurring leak. Tapping it
        opens Trends.
      </Text>

      {prefs.enabled ? (
        <Card className="gap-4">
          <View className="gap-2">
            <Text variant="caption">DAY</Text>
            <View className="flex-row justify-between">
              {DAY_LABELS.map((label, day) => {
                const selected = prefs.day === day;
                return (
                  <Pressable
                    key={day}
                    testID={`digest-day-${day}`}
                    accessibilityRole="button"
                    accessibilityLabel={DAY_NAMES[day]}
                    accessibilityState={{ selected }}
                    onPress={() => void setDay(day)}
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
            <Text variant="caption">TIME</Text>
            <View className="flex-row items-center gap-3">
              <Pressable
                testID="digest-hour-dec"
                accessibilityRole="button"
                accessibilityLabel="Earlier hour"
                onPress={() => void shiftHour(-1)}
                className="h-11 w-11 items-center justify-center rounded-full bg-surface"
              >
                <Text variant="heading">–</Text>
              </Pressable>
              <Text variant="heading">
                {formatReminderTime(prefs.hour, prefs.minute)}
              </Text>
              <Pressable
                testID="digest-hour-inc"
                accessibilityRole="button"
                accessibilityLabel="Later hour"
                onPress={() => void shiftHour(1)}
                className="h-11 w-11 items-center justify-center rounded-full bg-surface"
              >
                <Text variant="heading">+</Text>
              </Pressable>
            </View>
          </View>
        </Card>
      ) : null}
    </View>
  );
}
