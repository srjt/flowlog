import { Platform, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { authService, type OAuthProvider } from '@/services/AuthService';
import { logger } from '@/utils/logger';

/**
 * OAuth sign-in buttons (Supabase PKCE — no client secrets). Google shows on
 * every platform; Apple only on iOS, where it's required by App Store policy
 * when other social logins are present. On web the call redirects the page; on
 * native it opens an in-app browser session. The auth-state listener in the root
 * layout handles the resulting session.
 */
export function SocialAuthButtons({
  busy,
  setBusy,
  onError,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  onError: (message: string) => void;
}) {
  const run = async (provider: OAuthProvider) => {
    setBusy(true);
    try {
      await authService.signInWithOAuth(provider);
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
