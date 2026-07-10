import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DigestSettings } from '@/components/DigestSettings';
import { ReminderSettings } from '@/components/ReminderSettings';
import { Button, Card, Text } from '@/components/ui';
import { isDemoMode } from '@/config/featureFlags';
import { authService } from '@/services/AuthService';
import {
  COMING_SOON_SPORTS,
  getSportContext,
  registeredSportKeys,
} from '@/sports';
import { useSessionStore } from '@/store/sessionStore';
import { useUserStore } from '@/store/userStore';
import type { SportKey } from '@/types/sport';

/**
 * Screen 5 — Profile / Settings. Lets the user switch active sport, set their
 * skill level, see account info, and sign out. Sport/skill state lives in the
 * user store; switching sport is the horizontal-expansion mechanism made
 * visible to the user.
 */
export default function ProfileScreen() {
  const { authUser, activeSport, skillLevel, setActiveSport, setSkillLevel } =
    useUserStore();

  const sportKeys = registeredSportKeys();
  const activeContext = getSportContext(activeSport);

  const changeSport = (key: SportKey) => {
    if (key === activeSport) return;
    setActiveSport(key);
    const levels = getSportContext(key).skillLevels;
    setSkillLevel(levels[0] ?? '');
  };

  const signOut = () => {
    void authService.signOut();
    useSessionStore.getState().reset();
    useUserStore.getState().reset();
    router.replace('/(auth)/login');
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
                  onPress={() => setSkillLevel(level)}
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
        </View>

        <Card className="gap-1">
          <Text variant="caption">Session unit</Text>
          <Text variant="body">
            One “{activeContext.sessionUnit}” per recorded reflection.
          </Text>
        </Card>

        <ReminderSettings />

        <DigestSettings />

        <Button title="Sign out" variant="secondary" onPress={signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}
