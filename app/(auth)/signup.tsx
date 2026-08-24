import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';

/**
 * Invite-only notice, where self-service signup used to be.
 *
 * Public signup is disabled on the Supabase project, so `supabase.auth.signUp`
 * now fails with "Signups not allowed for this instance". Left alone, anyone
 * tapping Sign up — or following an old link, or a screenshot from a tester —
 * would read a raw backend error and conclude the app is broken. "Invite-only"
 * and "broken" look identical to a first-time visitor, and only one of them is
 * true.
 *
 * The route is KEPT rather than deleted so existing deep links and bookmarks
 * land somewhere that explains itself instead of 404ing.
 *
 * Why invite-only at all: the first cohort is hand-picked and needs to stay
 * something the team can vouch for, and the web build is publicly reachable
 * once the review bench is deployed. Client-side gating would not have done
 * it — `signUp` is a client call with a public anon key — so the control lives
 * on the project itself, and `auth.users` is now exactly the invited list.
 */
export default function SignupScreen() {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 justify-center gap-5 px-6">
        <Text variant="title">Flowlog is invite-only</Text>
        <Text variant="body">
          We&apos;re working with a small group of athletes while the coaching
          gets good. Accounts are created by invitation, so there&apos;s nothing
          to sign up for yet.
        </Text>
        <Text variant="caption">
          Already invited? Check your email for the invitation, set a password,
          then log in below.
        </Text>
        <Button
          testID="signup-back-to-login"
          title="Back to log in"
          onPress={() => router.replace('/(auth)/login')}
        />
      </View>
    </SafeAreaView>
  );
}
