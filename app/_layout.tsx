import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../global.css';
import { isDemoMode, isLocalPipeline } from '@/config/featureFlags';
import { authService } from '@/services/AuthService';
import {
  addReminderResponseListener,
  configureNotificationHandler,
  getInitialReminderUrl,
  loadReminderPrefs,
} from '@/services/NotificationService';
import { useUserStore } from '@/store/userStore';

/**
 * Root layout. Wraps the app in a safe-area provider and declares the two route
 * groups: (auth) for signed-out flows and (tabs) for the main app.
 *
 * Auth bootstrap:
 *  - demo / local-test mode → auto-sign-in a dev user (no login wall).
 *  - production → restore the Supabase session and subscribe to auth changes.
 */
export default function RootLayout() {
  const setAuthUser = useUserStore((s) => s.setAuthUser);
  const setProfile = useUserStore((s) => s.setProfile);
  const setOnboardingComplete = useUserStore((s) => s.setOnboardingComplete);
  const setReminderPrefs = useUserStore((s) => s.setReminderPrefs);

  // Reminder notifications: configure foreground display, hydrate saved prefs,
  // and route to Record when a reminder is tapped (cold launch or while open).
  useEffect(() => {
    configureNotificationHandler();
    loadReminderPrefs().then(setReminderPrefs);
    getInitialReminderUrl().then((url) => {
      if (url) router.push(url as never);
    });
    const unsubscribe = addReminderResponseListener((url) =>
      router.push(url as never),
    );
    return unsubscribe;
  }, [setReminderPrefs]);

  useEffect(() => {
    // Demo / local-test: auto-sign-in a dev user and skip the onboarding gate.
    if (isDemoMode || isLocalPipeline) {
      if (!useUserStore.getState().authUser) {
        setAuthUser({ id: 'dev-user', email: 'dev@flowlog.app' });
      }
      setOnboardingComplete(true);
      return;
    }
    let active = true;
    // Production: restore the session, then hydrate the profile so the entry
    // route knows whether to send the user through onboarding.
    authService.getSessionUser().then(async (user) => {
      if (!active || !user) return;
      setAuthUser(user);
      const profile = await authService.getProfile(user.id);
      if (active) setProfile(profile);
    });
    const unsubscribe = authService.onAuthChange(async (user) => {
      setAuthUser(user);
      if (user) {
        const profile = await authService.getProfile(user.id);
        setProfile(profile);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [setAuthUser, setProfile, setOnboardingComplete]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(flow)" />
        <Stack.Screen name="session/[id]" />
      </Stack>
    </SafeAreaProvider>
  );
}
