import { Redirect } from 'expo-router';

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
 */
export default function Index() {
  const authUser = useUserStore((s) => s.authUser);
  const onboardingComplete = useUserStore((s) => s.onboardingComplete);

  if (!authUser) return <Redirect href="/(auth)/login" />;
  if (!onboardingComplete) return <Redirect href="/(onboarding)/welcome" />;
  return <Redirect href="/(tabs)/record" />;
}
