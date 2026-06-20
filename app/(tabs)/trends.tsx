import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Text } from '@/components/ui';
import { SESSIONS_TO_UNLOCK } from '@/config/featureFlags';
import { applyDigestPrefs } from '@/services/NotificationService';
import { loadSessions } from '@/services/sessionsSource';
import {
  computeTrends,
  type SportTrends,
  type Tally,
} from '@/services/TrendsService';
import { getSportContext } from '@/sports';
import { useUserStore } from '@/store/userStore';
import { logger } from '@/utils/logger';

/**
 * Trends — the "improve over time" screen. Aggregates the user's saved sessions
 * for the active sport into a streak, focus area, most-worked positions, recent
 * recurring mistakes, and mood. Computed client-side from the session history.
 */
export default function TrendsScreen() {
  const { authUser, activeSport, digestPrefs } = useUserStore();
  const [trends, setTrends] = useState<SportTrends | null>(null);

  useFocusEffect(
    useCallback(() => {
      const userId = authUser?.id ?? 'demo-user';
      loadSessions(userId, activeSport)
        .then((sessions) => {
          const computed = computeTrends(
            sessions.filter((s) => s.sportKey === activeSport),
          );
          setTrends(computed);
          // Keep the weekly digest's baked-in summary fresh with the latest data.
          if (digestPrefs.enabled) {
            applyDigestPrefs(digestPrefs, computed).catch((err) =>
              logger.warn('digest refresh failed', err),
            );
          }
        })
        .catch((err) => logger.warn('trends load failed', err));
    }, [authUser, activeSport, digestPrefs]),
  );

  const unit = getSportContext(activeSport).sessionUnit;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-5 px-6 py-6">
        <Text variant="title">Trends</Text>

        {!trends || trends.sessionCount === 0 ? (
          <Card>
            <Text variant="caption">
              Record a few sessions and your trends will appear here.
            </Text>
          </Card>
        ) : (
          <>
            <View className="flex-row gap-3">
              <Stat value={`${trends.streakDays}`} label="day streak" />
              <Stat value={`${trends.sessionCount}`} label="sessions" />
              <Stat
                value={
                  trends.thumbsUpRate === null
                    ? '—'
                    : `${Math.round(trends.thumbsUpRate * 100)}%`
                }
                label="cues helpful"
              />
            </View>

            {trends.sessionCount < SESSIONS_TO_UNLOCK ? (
              <Text variant="caption" className="text-muted">
                Trends sharpen after {SESSIONS_TO_UNLOCK} sessions — here’s what
                we have so far.
              </Text>
            ) : null}

            {trends.focusArea ? (
              <Card className="gap-1 border border-primary">
                <Text variant="caption">FOCUS AREA</Text>
                <Text variant="heading">{trends.focusArea}</Text>
                <Text variant="caption">
                  The position showing up most in your {unit}s.
                </Text>
              </Card>
            ) : null}

            {trends.topPositions.length > 0 ? (
              <Card className="gap-3">
                <Text variant="heading">Most-worked positions</Text>
                <BarList items={trends.topPositions} />
              </Card>
            ) : null}

            {trends.recentMistakes.length > 0 ? (
              <Card className="gap-2">
                <Text variant="heading">Recurring mistakes</Text>
                {trends.recentMistakes.map((m, i) => (
                  <Text key={i} variant="body">
                    • {m}
                  </Text>
                ))}
              </Card>
            ) : null}

            {trends.moodBreakdown.length > 0 ? (
              <Card className="gap-3">
                <Text variant="heading">Mood</Text>
                <BarList items={trends.moodBreakdown} />
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card className="flex-1 items-center gap-1">
      <Text variant="title">{value}</Text>
      <Text variant="caption" className="text-center">
        {label}
      </Text>
    </Card>
  );
}

function BarList({ items }: { items: Tally[] }) {
  const max = items[0]?.count ?? 1;
  return (
    <View className="gap-2">
      {items.map((item) => (
        <View key={item.label} className="gap-1">
          <View className="flex-row items-center justify-between">
            <Text variant="body">{item.label}</Text>
            <Text variant="caption">{item.count}</Text>
          </View>
          <View className="h-2 rounded-full bg-background">
            <View
              className="h-2 rounded-full bg-primary"
              style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
