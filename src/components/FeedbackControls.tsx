import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui';
import { FEEDBACK_REASONS } from '@/constants/feedback';

/**
 * Thumbs up/down on a coaching cue. Choosing 👎 reveals single-select reason
 * chips (the most useful "why" signal). Controlled — the parent owns the state
 * and persists. Used by both the Result screen and Session Detail.
 */
export function FeedbackControls({
  thumb,
  reason,
  onThumb,
  onReason,
}: {
  thumb: boolean | null;
  reason: string | null;
  onThumb: (up: boolean) => void;
  onReason: (reason: string) => void;
}) {
  return (
    <View className="gap-3">
      <Text variant="caption">Was this cue useful?</Text>
      <View className="flex-row gap-3">
        <Pressable
          testID="thumb-up"
          accessibilityRole="button"
          accessibilityLabel="Mark cue helpful"
          accessibilityState={{ selected: thumb === true }}
          onPress={() => onThumb(true)}
          className={`h-12 flex-1 items-center justify-center rounded-xl border ${
            thumb === true
              ? 'border-success bg-success/20'
              : 'border-muted bg-surface'
          }`}
        >
          <Text variant="body">{thumb === true ? '👍 Helpful' : '👍'}</Text>
        </Pressable>
        <Pressable
          testID="thumb-down"
          accessibilityRole="button"
          accessibilityLabel="Mark cue unhelpful"
          accessibilityState={{ selected: thumb === false }}
          onPress={() => onThumb(false)}
          className={`h-12 flex-1 items-center justify-center rounded-xl border ${
            thumb === false
              ? 'border-danger bg-danger/20'
              : 'border-muted bg-surface'
          }`}
        >
          <Text variant="body">{thumb === false ? '👎 Off' : '👎'}</Text>
        </Pressable>
      </View>

      {thumb === false ? (
        <View className="gap-2">
          <Text variant="caption">What was off?</Text>
          <View className="flex-row flex-wrap gap-2">
            {FEEDBACK_REASONS.map((r) => {
              const selected = reason === r;
              return (
                <Pressable
                  key={r}
                  testID={`reason-${r}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Reason: ${r}`}
                  accessibilityState={{ selected }}
                  onPress={() => onReason(r)}
                  className={`min-h-[44px] justify-center rounded-full border px-3 py-2 ${
                    selected
                      ? 'border-primary bg-primary/20'
                      : 'border-muted bg-surface'
                  }`}
                >
                  <Text
                    variant="caption"
                    className={selected ? 'text-white' : 'text-muted'}
                  >
                    {r}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
