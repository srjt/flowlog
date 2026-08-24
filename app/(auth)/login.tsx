import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SocialAuthButtons } from '@/components/auth/SocialAuthButtons';
import { Button, Text } from '@/components/ui';
import { authService } from '@/services/AuthService';
import { useUserStore } from '@/store/userStore';
import { logger } from '@/utils/logger';

/**
 * Login screen — Supabase auth (email/password + OAuth) with password recovery.
 * On success it loads the user's profile (sport + skill level) into the store
 * and routes into the app.
 */
export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { setAuthUser, setProfile } = useUserStore();

  const onLogin = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const user = await authService.signIn(email.trim(), password);
      setAuthUser(user);
      // Safety net: ensure a profile row exists (a valid session now satisfies
      // RLS). The DB trigger normally handles this; this self-heals older users.
      await authService.ensureProfile(user.id);
      setProfile(await authService.getProfile(user.id));
      router.replace('/(tabs)/record');
    } catch (err) {
      logger.warn('sign-in failed', err);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onForgotPassword = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError('Enter your email first, then tap “Forgot password?”.');
      return;
    }
    setBusy(true);
    try {
      await authService.sendPasswordReset(email.trim());
      setNotice(`Password reset link sent to ${email.trim()}.`);
    } catch (err) {
      logger.warn('password reset failed', err);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 justify-center gap-4 px-6">
        <View className="mb-2 gap-2">
          <Text variant="title">Flowlog</Text>
          <Text variant="caption">Talk. Reflect. Improve.</Text>
        </View>
        <TextInput
          testID="login-email"
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
          testID="login-password"
          className="h-12 rounded-xl bg-surface px-4 text-white"
          placeholder="Password"
          placeholderTextColor="#8A8A99"
          secureTextEntry
          accessibilityLabel="Password"
          value={password}
          onChangeText={setPassword}
        />

        <Pressable
          testID="forgot-password"
          accessibilityRole="button"
          accessibilityLabel="Forgot password"
          onPress={() => void onForgotPassword()}
          className="min-h-[44px] justify-center self-end px-1"
        >
          <Text variant="caption" className="text-primary">
            Forgot password?
          </Text>
        </Pressable>

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

        <Button title="Log in" loading={busy} onPress={onLogin} />

        <SocialAuthButtons
          busy={busy}
          setBusy={setBusy}
          onError={setError}
          onSuccess={async () => {
            // Don't rely on the root layout's auth-state listener alone — its
            // async timing relative to this callback isn't guaranteed, and if
            // `/` renders before it updates the store, Index bounces straight
            // back to login. Load the session/profile here first so the
            // redirect always sees fresh state, same as the password path above.
            const user = await authService.getSessionUser();
            if (user) {
              setAuthUser(user);
              setProfile(await authService.getProfile(user.id));
            }
            router.replace('/');
          }}
        />

        {/* Invite-only: promising "create an account" and then explaining
            there is nothing to create wastes the tap and reads as a bug. */}
        <View className="mt-2 items-center gap-2">
          <Text variant="caption">Don&apos;t have an account?</Text>
          <Button
            testID="login-invite-only"
            title="Flowlog is invite-only"
            variant="ghost"
            className="w-full"
            disabled={busy}
            onPress={() => router.push('/(auth)/signup')}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
