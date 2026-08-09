import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WeeklyDigestView } from '@/components/WeeklyDigestView';
import { Text } from '@/components/ui';
import { useDigestHistory } from '@/hooks/useDigestHistory';

/**
 * Weekly Digest — detail for one week, opened from the history list. Renders the
 * stored snapshot for the given `weekId` (a self-contained recap, not recomputed
 * from live trends), so re-reading a past week always shows what that week
 * actually looked like.
 */
export default function DigestDetailScreen() {
  const { weekId } = useLocalSearchParams<{ weekId: string }>();
  const { history, loading } = useDigestHistory();
  const digest = history.find((d) => d.id === weekId) ?? null;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/digest/history');
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Weekly Digest',
          headerStyle: { backgroundColor: '#0B0B0F' },
          headerTintColor: '#FFFFFF',
          headerShadowVisible: false,
          headerBackTitle: 'Back',
          headerLeft: () => (
            <Pressable
              testID="digest-back"
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={12}
              onPress={goBack}
              className="px-2 py-1"
            >
              <Text variant="body" className="text-primary">
                ‹ Back
              </Text>
            </Pressable>
          ),
        }}
      />

      <ScrollView contentContainerClassName="gap-5 px-6 pb-8 pt-4">
        {loading ? null : digest ? (
          <WeeklyDigestView digest={digest} />
        ) : (
          <View className="items-center py-10">
            <Text variant="caption">Digest not found.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
