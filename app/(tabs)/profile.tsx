import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DigestSettings } from '@/components/DigestSettings';
import { ReminderSettings } from '@/components/ReminderSettings';
import { Button, Card, Text } from '@/components/ui';
import { isDemoMode, isLocalPipeline } from '@/config/featureFlags';
import { authService } from '@/services/AuthService';
import {
  COMING_SOON_SPORTS,
  getSportContext,
  registeredSportKeys,
} from '@/sports';
import { useSessionStore } from '@/store/sessionStore';
import { useUserStore } from '@/store/userStore';
import type { SportKey } from '@/types/sport';
import { logger } from '@/utils/logger';

/**
 * Screen 5 — Profile / Settings. Lets the user switch active sport, set their
 * skill level, see account info, and sign out. Sport/skill changes update the
 * local store immediately and persist to the profile row in the background so
 * they survive reinstalls and other devices.
 */
export default function ProfileScreen() {
  const { authUser, activeSport, skillLevel, setActiveSport, setSkillLevel } =
    useUserStore();
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const sportKeys = registeredSportKeys();
  const activeContext = getSportContext(activeSport);

  // Fire-and-forget server write; the local store is already updated so the
  // UI never blocks. On failure, tell the user their pick may not stick.
  const persistProfile = (fields: {
    activeSport?: SportKey;
    skillLevel?: string;
  }) => {
    if (!authUser || isDemoMode || isLocalPipeline) return;
    setSaveHint(null);
    authService.updateProfile(authUser.id, fields).catch((err) => {
      logger.error('profile save failed', err);
      setSaveHint(
        'Couldn’t save that to your account — it may not stick after reinstall or on other devices.',
      );
    });
  };

  const changeSport = (key: SportKey) => {
    if (key === activeSport) return;
    const level = getSportContext(key).skillLevels[0] ?? '';
    setActiveSport(key);
    setSkillLevel(level);
    // One PATCH for both fields — two racing writes could persist a
    // mismatched sport/skill pair.
    persistProfile({ activeSport: key, skillLevel: level });
  };

  const changeSkill = (level: string) => {
    setSkillLevel(level);
    persistProfile({ skillLevel: level });
  };

  const signOut = () => {
    void authService.signOut();
    useSessionStore.getState().reset();
    useUserStore.getState().reset();
    router.replace('/(auth)/login');
  };

  const onDeleteAccount = async () => {
    if (deletingAccount) return;
    setDeletingAccount(true);
    try {
      await authService.deleteAccount();
      // The account is gone server-side; the local sign-out is best-effort.
      await authService.signOut().catch(() => undefined);
      useSessionStore.getState().reset();
      useUserStore.getState().reset();
      router.replace('/(auth)/login');
    } catch (err) {
      logger.error('account deletion failed', err);
      setDeletingAccount(false);
      setConfirmDeleteAccount(false);
      setSaveHint(
        'Couldn’t delete your account. Check your connection and try again.',
      );
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-5 px-6 py-6">
        <View className="flex-row items-center justify-between">
          <Text variant="title">Profile</Text>
          {isDemoMode ? (
            <View className="rounded-full bg-accent/20 px-3 py-1">
              <Text variant="caption" className="text-accent">
                DEMO
              </Text>
            </View>
          ) : null}
        </View>

        <Card className="gap-1">
          <Text variant="caption">Signed in as</Text>
          <Text variant="body">{authUser?.email ?? 'Not signed in'}</Text>
        </Card>

        <View className="gap-2">
          <Text variant="caption">SPORT</Text>
          <View className="flex-row flex-wrap gap-2">
            {sportKeys.map((key) => {
              const selected = key === activeSport;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={getSportContext(key).displayName}
                  accessibilityState={{ selected }}
                  onPress={() => changeSport(key)}
                  className={`rounded-xl border px-4 py-3 ${
                    selected
                      ? 'border-primary bg-primary/20'
                      : 'border-muted bg-surface'
                  }`}
                >
                  <Text variant="body">{getSportContext(key).displayName}</Text>
                </Pressable>
              );
            })}
            {COMING_SOON_SPORTS.map(({ key, displayName }) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={displayName}
                accessibilityState={{ disabled: true }}
                disabled
                className="rounded-xl border border-muted bg-surface px-4 py-3 opacity-40"
              >
                <Text variant="body">{displayName} 🔒</Text>
              </Pressable>
            ))}
          </View>
          <Text variant="caption">Wrestling — coming soon.</Text>
        </View>

        <View className="gap-2">
          <Text variant="caption">SKILL LEVEL</Text>
          <View className="flex-row flex-wrap gap-2">
            {activeContext.skillLevels.map((level) => {
              const selected = level === skillLevel;
              return (
                <Pressable
                  key={level}
                  accessibilityRole="button"
                  accessibilityLabel={level}
                  accessibilityState={{ selected }}
                  onPress={() => changeSkill(level)}
                  className={`rounded-xl border px-4 py-3 ${
                    selected
                      ? 'border-primary bg-primary/20'
                      : 'border-muted bg-surface'
                  }`}
                >
                  <Text variant="body">{level}</Text>
                </Pressable>
              );
            })}
          </View>
          {saveHint ? (
            <Text variant="caption" className="text-accent">
              {saveHint}
            </Text>
          ) : null}
        </View>

        <Card className="gap-1">
          <Text variant="caption">Session unit</Text>
          <Text variant="body">
            One “{activeContext.sessionUnit}” per recorded reflection.
          </Text>
        </Card>

        <ReminderSettings />

        <DigestSettings />

        <Button
          testID="digest-history-link"
          title="View weekly digests"
          variant="secondary"
          onPress={() => router.push('/digest/history')}
        />

        {/* Replay mode only changes where the tour finishes -- it does NOT
            clear the seen flag, so replaying never re-arms the first-run
            tour on the next launch. */}
        <Button
          testID="replay-tour-link"
          title="Replay tour"
          variant="secondary"
          onPress={() => router.push('/(onboarding)/tour?mode=replay')}
        />

        <Button title="Sign out" variant="secondary" onPress={signOut} />

        {!isDemoMode && !isLocalPipeline ? (
          confirmDeleteAccount ? (
            <Card className="gap-3 border border-danger">
              <Text variant="body">
                Delete your account? This permanently removes your account,
                every session, and all audio recordings. This can’t be undone.
              </Text>
              <View className="flex-row gap-3">
                <Button
                  testID="account-delete-confirm"
                  title="Delete forever"
                  loading={deletingAccount}
                  className="flex-1 bg-danger"
                  onPress={() => void onDeleteAccount()}
                />
                <Button
                  testID="account-delete-cancel"
                  title="Cancel"
                  variant="secondary"
                  className="flex-1"
                  onPress={() => setConfirmDeleteAccount(false)}
                />
              </View>
            </Card>
          ) : (
            <Button
              testID="account-delete"
              title="Delete account"
              variant="ghost"
              onPress={() => setConfirmDeleteAccount(true)}
            />
          )
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
