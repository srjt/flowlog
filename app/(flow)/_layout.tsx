import { Redirect, Stack } from 'expo-router';

import { isDemoMode, isLocalPipeline } from '@/config/featureFlags';
import { useUserStore } from '@/store/userStore';

/**
 * Transient recording-flow screens (Processing → Result). These live OUTSIDE
 * the tab navigator on purpose: they're flow states, not destinations, so they
 * never appear as tabs. Reached via router.push from Record. Same auth guard as
 * the tabs group.
 */
export default function FlowLayout() {
  const authUser = useUserStore((s) => s.authUser);
  if (!authUser && !isDemoMode && !isLocalPipeline) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0B0B0F' },
      }}
    />
  );
}
