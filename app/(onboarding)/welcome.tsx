import { Audio } from 'expo-av';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text } from '@/components/ui';
import { featureFlags, isDemoMode, isLocalPipeline } from '@/config/featureFlags';
import { authService } from '@/services/AuthService';
import { getSportContext, registeredSportKeys } from '@/sports';
import { useUserStore } from '@/store/userStore';
import type { SportKey } from '@/types/sport';
import { logger } from '@/utils/logger';

type Step = 'welcome' | 'sport' | 'skill' | 'mic';

const VALUE_CARDS = [
  {
    title: 'Talk it out',
    body: 'A 60–90 second voice note after each session. No typing, no forms.',
  },
  {
    title: 'One cue back',
    body: 'A single mechanical fix to take into your next session — never a wall of text.',
  },
  {
    title: 'See your patterns',
    body: 'Sessions build into a trend log that surfaces the weakness you keep hitting.',
  },
];

/**
 * First-run onboarding. Account-first: the user is already authenticated, so
 * their sport/skill picks persist to their profile. Steps: value intro → sport
 * → skill → mic priming. Finishing writes the profile and marks onboarding
 * complete, then drops the user on the recorder.
 */
export default function Welcome() {
  const { authUser, setActiveSport, setSkillLevel, setOnboardingComplete } =
    useUserStore();

  const [step, setStep] = useState<Step>('welcome');
  const [sport, setSport] = useState<SportKey>('bjj');
  const [skill, setSkill] = useState<string>(
    getSportContext('bjj').skillLevels[0] ?? '',
  );
  const [finishing, setFinishing] = useState(false);

  const sportKeys = registeredSportKeys();
  const isSportEnabled = (key: SportKey) =>
    key === 'bjj' || featureFlags.golfSport || isDemoMode;

  const pickSport = (key: SportKey) => {
    if (!isSportEnabled(key)) return;
    setSport(key);
    setSkill(getSportContext(key).skillLevels[0] ?? '');
  };

  const primeMic = async () => {
    // Priming only — we ask now so the in-session prompt isn't a surprise. A
    // denial here is fine; the recorder re-requests when they actually record.
    try {
      await Audio.requestPermissionsAsync();
    } catch (err) {
      logger.warn('mic priming request failed', err);
    }
    await finish();
  };

  const finish = async () => {
    setFinishing(true);
    setActiveSport(sport);
    setSkillLevel(skill);
    try {
      if (authUser && !isDemoMode && !isLocalPipeline) {
        await authService.completeOnboarding(authUser.id, sport, skill);
      }
    } catch (err) {
      logger.warn('persisting onboarding failed', err);
    }
    setOnboardingComplete(true);
    router.replace('/(tabs)/record');
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="flex-grow gap-6 px-6 py-8">
        {step === 'welcome' ? (
          <View className="flex-1 gap-6">
            <View className="gap-2">
              <Text variant="title">Welcome to Flowlog</Text>
              <Text variant="caption">Talk. Reflect. Improve.</Text>
            </View>
            <View className="gap-3">
              {VALUE_CARDS.map((c) => (
                <Card key={c.title} className="gap-1">
                  <Text variant="body">{c.title}</Text>
                  <Text variant="caption">{c.body}</Text>
                </Card>
              ))}
            </View>
            <Button
              testID="onboarding-start"
              title="Get started"
              onPress={() => setStep('sport')}
            />
          </View>
        ) : null}

        {step === 'sport' ? (
          <View className="flex-1 gap-6">
            <View className="gap-2">
              <Text variant="title">Pick your sport</Text>
              <Text variant="caption">
                This tailors the vocabulary and coaching. You can switch later in
                Profile.
              </Text>
            </View>
            <View className="gap-3">
              {sportKeys.map((key) => {
                const enabled = isSportEnabled(key);
                const selected = key === sport;
                return (
                  <Pressable
                    key={key}
                    testID={`onboarding-sport-${key}`}
                    accessibilityRole="button"
                    accessibilityLabel={getSportContext(key).displayName}
                    accessibilityState={{ selected, disabled: !enabled }}
                    disabled={!enabled}
                    onPress={() => pickSport(key)}
                    className={`rounded-xl border px-4 py-4 ${
                      selected
                        ? 'border-primary bg-primary/20'
                        : 'border-muted bg-surface'
                    } ${enabled ? '' : 'opacity-40'}`}
                  >
                    <Text variant="body">
                      {getSportContext(key).displayName}
                      {enabled ? '' : ' 🔒 coming soon'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Button
              testID="onboarding-sport-next"
              title="Continue"
              onPress={() => setStep('skill')}
            />
          </View>
        ) : null}

        {step === 'skill' ? (
          <View className="flex-1 gap-6">
            <View className="gap-2">
              <Text variant="title">Your level</Text>
              <Text variant="caption">
                So cues match where you are. Adjust it anytime.
              </Text>
            </View>
            <View className="gap-3">
              {getSportContext(sport).skillLevels.map((level) => {
                const selected = level === skill;
                return (
                  <Pressable
                    key={level}
                    testID={`onboarding-skill-${level}`}
                    accessibilityRole="button"
                    accessibilityLabel={level}
                    accessibilityState={{ selected }}
                    onPress={() => setSkill(level)}
                    className={`rounded-xl border px-4 py-4 ${
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
            <Button
              testID="onboarding-skill-next"
              title="Continue"
              onPress={() => setStep('mic')}
            />
          </View>
        ) : null}

        {step === 'mic' ? (
          <View className="flex-1 gap-6">
            <View className="gap-2">
              <Text variant="title">One last thing</Text>
              <Text variant="caption">
                Flowlog needs your microphone to capture reflections. Your audio
                is only used to generate your cue.
              </Text>
            </View>
            <Card className="gap-1">
              <Text variant="body">🎙️ Microphone</Text>
              <Text variant="caption">
                We’ll ask for permission next. You can always change it in your
                device settings.
              </Text>
            </Card>
            <View className="gap-3">
              <Button
                testID="onboarding-finish"
                title="Enable microphone & start"
                loading={finishing}
                onPress={() => void primeMic()}
              />
              <Button
                testID="onboarding-skip-mic"
                title="Skip for now"
                variant="ghost"
                disabled={finishing}
                onPress={() => void finish()}
              />
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
