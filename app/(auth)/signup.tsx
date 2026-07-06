import { router } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SocialAuthButtons } from '@/components/auth/SocialAuthButtons';
import { Button, Text } from '@/components/ui';
import { authService } from '@/services/AuthService';
import { useUserStore } from '@/store/userStore';
import { logger } from '@/utils/logger';

const MIN_PASSWORD_LENGTH = 6;

/**
 * Signup screen — real Supabase auth. Creates the auth user and a profile row,
 * then routes into the app. (If email confirmation is enabled on the project,
 * the user must confirm before they can sign in.)
 */
export default function SignupScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { setAuthUser, setProfile } = useUserStore();

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  const onSignup = async () => {
    setError(null);
    setNotice(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    try {
      const user = await authService.signUp(email.trim(), password);
      // If the project requires email confirmation there's no active session yet.
      const active = await authService.getSessionUser();
      if (active) {
        setAuthUser(user);
        router.replace('/(tabs)/record');
      } else {
        setNotice('Account created. Check your email to confirm, then log in.');
      }
    } catch (err) {
      logger.warn('sign-up failed', err);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 justify-center gap-4 px-6">
        <Text variant="title">Create account</Text>
        <TextInput
          testID="signup-email"
          className="h-12 rounded-xl bg-surface px-4 text-white"
          placeholder="Email"
          placeholderTextColor="#8A8A99"
          autoCapitalize="none"
          keyboardType="email-address"
          accessibilityLabel="Email"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          testID="signup-password"
          className="h-12 rounded-xl bg-surface px-4 text-white"
          placeholder="Password"
          placeholderTextColor="#8A8A99"
          secureTextEntry
          accessibilityLabel="Password"
          value={password}
          onChangeText={setPassword}
        />
        {/* Persistent guidance, not just an after-the-fact error. */}
        <Text
          variant="caption"
          className={passwordTooShort ? 'text-danger' : ''}
        >
          Use at least {MIN_PASSWORD_LENGTH} characters.
        </Text>

        {error ? (
          <Text variant="caption" className="text-danger">
            {error}
          </Text>
        ) : null}
        {notice ? (
          <Text variant="caption" className="text-success">
            {notice}
          </Text>
        ) : null}
        <Button title="Sign up" loading={busy} onPress={onSignup} />

        <SocialAuthButtons
          busy={busy}
          setBusy={setBusy}
          onError={setError}
          onSuccess={async () => {
            // Mirrors login's onSuccess: load session/profile deterministically
            // before navigating, rather than relying on the root layout's
            // async auth-state listener to have updated the store in time.
            const user = await authService.getSessionUser();
            if (user) {
              setAuthUser(user);
              setProfile(await authService.getProfile(user.id));
            }
            router.replace('/');
          }}
        />

        <Button
          title="I already have an account"
          variant="secondary"
          disabled={busy}
          onPress={() => router.back()}
        />
      </View>
    </SafeAreaView>
  );
}
