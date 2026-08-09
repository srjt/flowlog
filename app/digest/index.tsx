import { router, Stack } from 'expo-router';
import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WeeklyDigestView } from '@/components/WeeklyDigestView';
import { Button, Card, Text } from '@/components/ui';
import { useDigestHistory } from '@/hooks/useDigestHistory';

/**
 * Weekly Digest — latest. The dedicated page the digest notification deep-links
 * to (DIGEST_ROUTE = "/digest"): it materializes any newly-elapsed weeks and
 * shows the most recent one's recap, instead of dropping the user on the generic
 * Trends tab. Works for both warm taps and cold launches via the root layout's
 * existing notification deep-link handler.
 */
export default function LatestDigestScreen() {
  const { history, loading } = useDigestHistory();
  const latest = history[0] ?? null;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/trends');
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
        {loading ? null : latest ? (
          <>
            <WeeklyDigestView digest={latest} />
            {history.length > 1 ? (
              <Button
                testID="digest-view-history"
                title="View all digests"
                variant="secondary"
                onPress={() => router.push('/digest/history')}
              />
            ) : null}
          </>
        ) : (
          <Card className="items-center gap-2">
            <Text variant="heading" className="text-center">
              No digests yet
            </Text>
            <Text variant="caption" className="text-center">
              Your first Weekly Digest appears here once you’ve trained through
              a full week. Keep logging your sessions.
            </Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
