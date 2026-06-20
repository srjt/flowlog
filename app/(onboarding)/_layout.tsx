import { Stack } from 'expo-router';

/** First-run onboarding group. One screen drives the step flow. */
export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
