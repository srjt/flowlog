import { Audio } from 'expo-av';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text } from '@/components/ui';
import { isDemoMode, isLocalPipeline } from '@/config/featureFlags';
import { authService } from '@/services/AuthService';
import {
  COMING_SOON_SPORTS,
  getSportContext,
  registeredSportKeys,
} from '@/sports';
import { useUserStore } from '@/store/userStore';
import type { SportKey } from '@/types/sport';
import type { GiPreference } from '@/types/user';
import { logger } from '@/utils/logger';

type Step = 'welcome' | 'sport' | 'skill' | 'attire' | 'mic';

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
  const {
    authUser,
    setActiveSport,
    setSkillLevel,
    setGiDefault,
    setOnboardingComplete,
  } = useUserStore();

  const [step, setStep] = useState<Step>('welcome');
  const [sport, setSport] = useState<SportKey>('bjj');
  const [skill, setSkill] = useState<string>(
    getSportContext('bjj').skillLevels[0] ?? '',
  );
  const [gi, setGi] = useState<GiPreference>('gi');
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState(false);

  const sportKeys = registeredSportKeys();

  const pickSport = (key: SportKey) => {
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
    setFinishError(false);
    setActiveSport(sport);
    setGiDefault(gi);
    setSkillLevel(skill);
    if (authUser && !isDemoMode && !isLocalPipeline) {
      try {
        await authService.completeOnboarding(authUser.id, sport, skill, gi);
      } catch (err) {
        // Do NOT mark complete or navigate: the profile row still says
        // onboarding_complete=false, so the next cold launch would bounce the
        // user back here with their picks lost. Show retry instead.
        logger.error('persisting onboarding failed', err);
        setFinishing(false);
        setFinishError(true);
        return;
      }
    }
    setOnboardingComplete(true);
    router.replace('/(tabs)/record');
  };

  /**
   * Escape hatch when the save keeps failing (e.g. captive wifi): proceed on
   * local state only. The caption warns that picks may not stick — the next
   * launch re-reads the profile row, which still says not-onboarded.
   */
  const continueAnyway = () => {
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
                This tailors the vocabulary and coaching. You can switch later
                in Profile.
              </Text>
            </View>
            <View className="gap-3">
              {sportKeys.map((key) => {
                const selected = key === sport;
                return (
                  <Pressable
                    key={key}
                    testID={`onboarding-sport-${key}`}
                    accessibilityRole="button"
                    accessibilityLabel={getSportContext(key).displayName}
                    accessibilityState={{ selected }}
                    onPress={() => pickSport(key)}
                    className={`rounded-xl border px-4 py-4 ${
                      selected
                        ? 'border-primary bg-primary/20'
                        : 'border-muted bg-surface'
                    }`}
                  >
                    <Text variant="body">
                      {getSportContext(key).displayName}
                    </Text>
                  </Pressable>
                );
              })}
              {COMING_SOON_SPORTS.map(({ key, displayName }) => (
                <Pressable
                  key={key}
                  testID={`onboarding-sport-${key}`}
                  accessibilityRole="button"
                  accessibilityLabel={displayName}
                  accessibilityState={{ disabled: true }}
                  disabled
                  className="rounded-xl border border-muted bg-surface px-4 py-4 opacity-40"
                >
                  <Text variant="body">{displayName} 🔒 coming soon</Text>
                </Pressable>
              ))}
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
              onPress={() => setStep('attire')}
            />
          </View>
        ) : null}

        {step === 'attire' ? (
          <View className="gap-6">
            <View className="gap-2">
              <Text variant="title">Gi or no-gi?</Text>
              <Text variant="caption">
                Some techniques rely on grips that only exist with a jacket. You
                can switch this for any single session.
              </Text>
            </View>
            <View className="gap-3">
              {(['gi', 'no-gi'] as const).map((option) => {
                const selected = option === gi;
                return (
                  <Pressable
                    key={option}
                    testID={`onboarding-attire-${option}`}
                    accessibilityRole="button"
                    accessibilityLabel={option === 'gi' ? 'Gi' : 'No-gi'}
                    accessibilityState={{ selected }}
                    onPress={() => setGi(option)}
                    className={`rounded-xl border px-4 py-4 ${
                      selected
                        ? 'border-primary bg-primary/20'
                        : 'border-muted bg-surface'
                    }`}
                  >
                    <Text variant="body">
                      {option === 'gi' ? 'Gi' : 'No-gi'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Button
              testID="onboarding-attire-next"
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
            {finishError ? (
              <Card className="gap-3 border border-danger">
                <Text variant="body">
                  We couldn’t save your picks to your account. Check your
                  connection and retry.
                </Text>
                <Button
                  testID="onboarding-retry"
                  title="Retry"
                  loading={finishing}
                  onPress={() => void finish()}
                />
                <Button
                  testID="onboarding-continue-anyway"
                  title="Continue anyway"
                  variant="ghost"
                  disabled={finishing}
                  onPress={continueAnyway}
                />
                <Text variant="caption">
                  If you continue, your sport and level may reset next time you
                  open the app.
                </Text>
              </Card>
            ) : (
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
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
