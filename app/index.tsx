import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useUserStore } from '@/store/userStore';

/**
 * Entry route. Routes by auth + onboarding state:
 *  - not signed in        → login
 *  - signed in, new user  → onboarding (sport/skill pick, mic priming)
 *  - signed in, onboarded → recorder
 *
 * Account-first: a user authenticates BEFORE onboarding so their sport/skill
 * picks persist to their profile row. Demo / local modes mark onboarding
 * complete in the root layout, so they fall straight through to the recorder.
 *
 * Waits on authBootstrapped before redirecting anywhere: the root layout's
 * session restore is async, so on a cold launch authUser is still null for a
 * brief moment even for an already-logged-in user. Redirecting to /login
 * immediately on that first render would strand them there permanently --
 * nothing re-routes a user who has already navigated past this screen.
 */
export default function Index() {
  const authUser = useUserStore((s) => s.authUser);
  const onboardingComplete = useUserStore((s) => s.onboardingComplete);
  const authBootstrapped = useUserStore((s) => s.authBootstrapped);

  if (!authBootstrapped) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#FFFFFF" />
      </View>
    );
  }
  if (!authUser) return <Redirect href="/(auth)/login" />;
  if (!onboardingComplete) return <Redirect href="/(onboarding)/welcome" />;
  return <Redirect href="/(tabs)/record" />;
}
