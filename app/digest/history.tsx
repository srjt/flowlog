import { router, Stack } from 'expo-router';
import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Text } from '@/components/ui';
import { formatWeekLabel, type WeeklyDigest } from '@/services/DigestService';
import { useDigestHistory } from '@/hooks/useDigestHistory';

/**
 * Weekly Digest — history. Lists captured weekly digests newest-first; each row
 * opens that week's detail. Reachable in-app from Profile, so digests can be
 * reviewed any time without waiting for (or having kept) a notification.
 */
export default function DigestHistoryScreen() {
  const { history, loading } = useDigestHistory();

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/trends');
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Digest history',
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

      <ScrollView contentContainerClassName="gap-3 px-6 pb-8 pt-4">
        {loading ? null : history.length === 0 ? (
          <Card testID="digest-history-empty" className="items-center gap-2">
            <Text variant="heading" className="text-center">
              No digests yet
            </Text>
            <Text variant="caption" className="text-center">
              Once you’ve trained through a full week, a Weekly Digest is saved
              here for you to revisit.
            </Text>
          </Card>
        ) : (
          history.map((digest) => <DigestRow key={digest.id} digest={digest} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DigestRow({ digest }: { digest: WeeklyDigest }) {
  const weekLabel = formatWeekLabel(digest.weekStart);
  return (
    <Pressable
      testID={`digest-row-${digest.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${weekLabel}. ${digest.body}`}
      onPress={() => router.push(`/digest/${digest.id}`)}
    >
      <Card className="min-h-[44px] gap-1">
        <Text variant="body">{weekLabel}</Text>
        <Text variant="caption" className="text-muted">
          Focus: {digest.focusArea ?? '—'} · Leak: {digest.recurringLeak ?? '—'}
        </Text>
      </Card>
    </Pressable>
  );
}
