import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Card, Text } from '@/components/ui';
import { SESSIONS_TO_UNLOCK } from '@/config/featureFlags';

/**
 * Reward framing on the Output screen. The first-ever result gets a distinct,
 * one-time celebration; later results get a lightweight progress line toward the
 * 10-session Trends unlock. The one-time state is owned by the caller (persisted
 * via `markFirstResultCelebrated`) so it never replays. Reduced-motion users get
 * the same highlighted card without the entrance animation.
 */
export function FirstResultCelebration({
  sessionCount,
  celebrate,
}: {
  sessionCount: number;
  celebrate: boolean;
}) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (celebrate && !reduced) {
      scale.value = 0.96;
      scale.value = withSequence(
        withTiming(1.03, { duration: 220 }),
        withTiming(1, { duration: 180 }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebrate, reduced]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  if (sessionCount <= 0) return null;

  if (celebrate) {
    return (
      <Animated.View style={animatedStyle}>
        <Card
          testID="first-result-celebration"
          className="items-center gap-2 border border-accent bg-accent/10"
        >
          <Text variant="heading" className="text-center">
            🎉 First reflection logged
          </Text>
          <Text variant="caption" className="text-center">
            You’ve started your trend log. Keep going — Trends unlock at{' '}
            {SESSIONS_TO_UNLOCK} sessions.
          </Text>
        </Card>
      </Animated.View>
    );
  }

  if (sessionCount >= SESSIONS_TO_UNLOCK) {
    return (
      <Text testID="result-progress" variant="caption" className="text-success">
        Trends unlocked — check the Trends tab.
      </Text>
    );
  }

  const pct = Math.min(100, (sessionCount / SESSIONS_TO_UNLOCK) * 100);
  return (
    <View testID="result-progress" className="gap-1">
      <Text variant="caption">
        Session {sessionCount} of {SESSIONS_TO_UNLOCK} — Trends unlock at{' '}
        {SESSIONS_TO_UNLOCK}.
      </Text>
      <View className="h-2 rounded-full bg-surface">
        <View
          className="h-2 rounded-full bg-primary"
          style={{ width: `${Math.max(6, pct)}%` }}
        />
      </View>
    </View>
  );
}
