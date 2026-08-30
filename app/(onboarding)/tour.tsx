import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { SESSIONS_TO_UNLOCK } from '@/config/featureFlags';
import { markFeatureTourSeen } from '@/utils/featureTour';

/**
 * One slide per tab, in tab order. Slide 1 is the hero: everything else exists
 * to make that promise land, so it leads and states the core loop outright.
 * Icon + text rather than screenshots, which rot as the UI moves on.
 */
const SLIDES: { icon: string; title: string; body: string }[] = [
  {
    icon: '🎙️',
    title: 'Record',
    body: 'Talk for 60 seconds after training. Flowlog gives you one specific thing to work on.',
  },
  {
    icon: '🗓️',
    title: 'Log',
    body: 'Every reflection is saved and grouped by week, so you can look back on what you worked on.',
  },
  {
    icon: '📈',
    title: 'Trends',
    body: `Log ${SESSIONS_TO_UNLOCK} sessions and Flowlog surfaces the weakness that keeps coming back.`,
  },
  {
    icon: '⚙️',
    title: 'Profile',
    body: 'Set a post-training reminder and a weekly digest, so reflecting turns into a habit.',
  },
];

/**
 * First-run feature tour. A standalone screen rather than a step of the welcome
 * flow, so it can be tuned and replayed on its own. Shown once, gated by a local
 * flag (`featureTour`) that both the entry gate and the welcome-completion path
 * check — a user only reaches this route when it is genuinely unseen.
 *
 * `mode=replay` (the Profile "Replay tour" row) changes exactly one thing: where
 * finishing lands. Replay returns to Profile; first-run flows on to Record.
 */
export default function FeatureTour() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isReplay = mode === 'replay';

  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const last = index === SLIDES.length - 1;

  const goTo = (next: number) => {
    setIndex(next);
    // Motion the user cannot opt out of is the one thing to avoid here, so the
    // programmatic hop is instant under reduced motion.
    scrollRef.current?.scrollTo({ x: width * next, animated: !reduced });
  };

  // Skip and finishing both count as done: the tour has had its shot either way.
  const done = async () => {
    await markFeatureTourSeen();
    router.replace(isReplay ? '/(tabs)/profile' : '/(tabs)/record');
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row justify-end px-4 py-2">
        <Pressable
          testID="tour-skip"
          accessibilityRole="button"
          accessibilityLabel="Skip the tour"
          hitSlop={12}
          onPress={() => void done()}
          className="min-h-[44px] justify-center px-4"
        >
          <Text variant="body" className="text-muted">
            Skip
          </Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        testID="tour-pager"
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) =>
          setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
        }
        className="flex-1"
      >
        {SLIDES.map((slide) => (
          <View
            key={slide.title}
            accessible
            accessibilityLabel={`${slide.title}. ${slide.body}`}
            style={{ width }}
            className="flex-1 items-center justify-center gap-4 px-8"
          >
            <Text className="text-6xl">{slide.icon}</Text>
            <Text variant="title" className="text-center">
              {slide.title}
            </Text>
            <Text variant="body" className="text-center text-muted">
              {slide.body}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View className="gap-6 px-6 pb-6">
        <View
          testID="tour-dots"
          accessibilityRole="progressbar"
          accessibilityLabel={`Slide ${index + 1} of ${SLIDES.length}`}
          accessibilityValue={{ min: 1, max: SLIDES.length, now: index + 1 }}
          className="flex-row justify-center gap-2"
        >
          {SLIDES.map((slide, i) => (
            <View
              key={slide.title}
              className={`h-2 w-2 rounded-full ${
                i === index ? 'bg-primary' : 'bg-muted opacity-40'
              }`}
            />
          ))}
        </View>

        <Button
          testID="tour-next"
          title={last ? 'Start reflecting' : 'Next'}
          onPress={() => (last ? void done() : goTo(index + 1))}
        />
      </View>
    </SafeAreaView>
  );
}
