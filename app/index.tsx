import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useUserStore } from '@/store/userStore';
import { hasSeenFeatureTour } from '@/utils/featureTour';

/**
 * Entry route. Routes by auth + onboarding state:
 *  - not signed in            → login
 *  - signed in, new user      → onboarding (sport/skill pick, mic priming)
 *  - onboarded, no tour yet   → feature tour
 *  - onboarded, tour seen     → recorder
 *
 * Account-first: a user authenticates BEFORE onboarding so their sport/skill
 * picks persist to their profile row. Demo / local modes mark onboarding
 * complete in the root layout, so they fall through to the tour, then the
 * recorder.
 *
 * The tour check lives here as well as on the welcome-completion path because
 * everyone who bypasses welcome — returning users, demo/local, and testers who
 * onboarded before the tour existed — arrives through this gate instead.
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
  const [tourSeen, setTourSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void hasSeenFeatureTour().then((seen) => {
      if (active) setTourSeen(seen);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!authBootstrapped || tourSeen === null) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#FFFFFF" />
      </View>
    );
  }
  if (!authUser) return <Redirect href="/(auth)/login" />;
  if (!onboardingComplete) return <Redirect href="/(onboarding)/welcome" />;
  if (!tourSeen) return <Redirect href="/(onboarding)/tour" />;
  return <Redirect href="/(tabs)/record" />;
}
