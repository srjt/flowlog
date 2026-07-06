import { Platform, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { authService, type OAuthProvider } from '@/services/AuthService';
import { logger } from '@/utils/logger';

/**
 * OAuth sign-in buttons (Supabase PKCE — no client secrets). Google shows on
 * every platform; Apple only on iOS, where it's required by App Store policy
 * when other social logins are present. On web the call redirects the page; on
 * native it opens an in-app browser session. The auth-state listener in the root
 * layout loads the resulting profile into the store, but nothing navigates the
 * screen away on its own — `onSuccess` does that (mirrors what the email/password
 * screens do explicitly after their own sign-in calls).
 */
export function SocialAuthButtons({
  busy,
  setBusy,
  onError,
  onSuccess,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  onError: (message: string) => void;
  onSuccess: () => void;
}) {
  const run = async (provider: OAuthProvider) => {
    setBusy(true);
    try {
      const signedIn = await authService.signInWithOAuth(provider);
      if (signedIn) onSuccess();
    } catch (err) {
      logger.warn('oauth sign-in failed', err);
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <View className="h-px flex-1 bg-muted" />
        <Text variant="caption">or</Text>
        <View className="h-px flex-1 bg-muted" />
      </View>
      <Button
        testID="oauth-google"
        title="Continue with Google"
        variant="secondary"
        disabled={busy}
        accessibilityLabel="Continue with Google"
        onPress={() => void run('google')}
      />
      {Platform.OS === 'ios' ? (
        <Button
          testID="oauth-apple"
          title="Continue with Apple"
          variant="secondary"
          disabled={busy}
          accessibilityLabel="Continue with Apple"
          onPress={() => void run('apple')}
        />
      ) : null}
    </View>
  );
}
