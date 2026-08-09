import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { formatWeekLabel, type WeeklyDigest } from '@/services/DigestService';

/**
 * Presentational recap of a single `WeeklyDigest`: the week it summarizes, plus
 * that week's focus area and recurring leak. Pure — the screen owns loading and
 * navigation. Exposes a descriptive accessibility label so screen readers
 * announce the recap as a unit.
 */
export function WeeklyDigestView({ digest }: { digest: WeeklyDigest }) {
  const weekLabel = formatWeekLabel(digest.weekStart);
  return (
    <View
      testID="weekly-digest"
      accessible
      accessibilityLabel={`Weekly digest — ${weekLabel}. ${digest.body}`}
      className="gap-5"
    >
      <View className="gap-1">
        <Text variant="caption">WEEKLY DIGEST</Text>
        <Text variant="title">{weekLabel}</Text>
        <Text variant="caption" className="text-muted">
          {digest.sport.toUpperCase()}
        </Text>
      </View>

      <Card className="gap-1 border border-primary">
        <Text variant="caption">FOCUS AREA</Text>
        <Text variant="heading">
          {digest.focusArea ?? 'A bit of everything'}
        </Text>
      </Card>

      <Card className="gap-1 border border-accent">
        <Text variant="caption">RECURRING LEAK</Text>
        <Text variant="heading">
          {digest.recurringLeak ?? 'Nothing flagged'}
        </Text>
      </Card>

      <Card>
        <Text variant="body">{digest.body}</Text>
      </Card>
    </View>
  );
}
