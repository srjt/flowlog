import { View } from 'react-native';

import { Card, Skeleton, Text } from '@/components/ui';
import { SESSIONS_TO_UNLOCK } from '@/config/featureFlags';
import type { SportTrends } from '@/services/TrendsService';

/**
 * Compact habit strip for the idle Record screen: day streak, session count,
 * and progress toward unlocking Trends. Shows a skeleton while loading and an
 * encouraging prompt for brand-new users. Values come from `computeTrends`
 * (single source of truth) via `useSessionTrends`.
 */
export function StreakStrip({
  trends,
  loading,
}: {
  trends: SportTrends | null;
  loading: boolean;
}) {
  if (loading) {
    return <Skeleton testID="streak-skeleton" className="h-[68px] w-full" />;
  }

  if (!trends || trends.sessionCount === 0) {
    return (
      <Card className="items-center">
        <Text variant="caption" className="text-center">
          Record your first reflection to start a streak — one cue every
          session.
        </Text>
      </Card>
    );
  }

  const count = trends.sessionCount;
  const remaining = Math.max(0, SESSIONS_TO_UNLOCK - count);
  const pct = Math.min(100, (count / SESSIONS_TO_UNLOCK) * 100);

  return (
    <Card testID="streak-strip" className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="body">🔥 {trends.streakDays}-day streak</Text>
        <Text variant="caption">{count} sessions</Text>
      </View>
      {remaining > 0 ? (
        <View className="gap-1">
          <Text variant="caption">
            {count} of {SESSIONS_TO_UNLOCK} — trends unlock at{' '}
            {SESSIONS_TO_UNLOCK}
          </Text>
          <View className="h-2 rounded-full bg-background">
            <View
              className="h-2 rounded-full bg-primary"
              style={{ width: `${Math.max(6, pct)}%` }}
            />
          </View>
        </View>
      ) : (
        <Text variant="caption" className="text-success">
          Trends unlocked — see the Trends tab.
        </Text>
      )}
    </Card>
  );
}
