import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedbackControls } from '@/components/FeedbackControls';
import { FirstResultCelebration } from '@/components/FirstResultCelebration';
import { Button, Card, Text } from '@/components/ui';
import { isDemoMode } from '@/config/featureFlags';
import { loadSessions, saveSessionFeedback } from '@/services/sessionsSource';
import { computeTrends } from '@/services/TrendsService';
import { useSessionStore } from '@/store/sessionStore';
import { useUserStore } from '@/store/userStore';
import {
  hasCelebratedFirstResult,
  markFirstResultCelebrated,
} from '@/utils/firstResult';
import { logger } from '@/utils/logger';

/**
 * Structured result. Shows the one coaching cue + summary and captures thumbs
 * feedback. If reached without a result (deep link / refresh), redirects back
 * to Record — no dead end.
 */
export default function OutputScreen() {
  const { latestResult, reset, setFeedback } = useSessionStore();
  const { authUser, activeSport } = useUserStore();
  const [thumb, setThumb] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [celebrate, setCelebrate] = useState(false);

  // Count the user's sessions for this sport to drive the unlock progress, and
  // fire the one-time celebration on the very first result (persisted so it
  // never replays).
  useEffect(() => {
    let active = true;
    loadSessions(authUser?.id ?? 'demo-user', activeSport)
      .then(async (sessions) => {
        if (!active) return;
        const count = computeTrends(
          sessions.filter((s) => s.sportKey === activeSport),
        ).sessionCount;
        setSessionCount(count);
        if (count === 1 && !(await hasCelebratedFirstResult())) {
          if (!active) return;
          setCelebrate(true);
          await markFirstResultCelebrated();
        }
      })
      .catch((err) => logger.warn('result progress load failed', err));
    return () => {
      active = false;
    };
  }, [authUser, activeSport]);

  if (!latestResult) {
    return <Redirect href="/(tabs)/record" />;
  }

  const persist = (up: boolean, r: string | null, n: string | null) => {
    setFeedback(latestResult.sessionId, up, r, n); // updates the Log entry too
    saveSessionFeedback(latestResult.sessionId, up, r, n).catch((err) =>
      logger.warn('feedback save failed', err),
    );
  };

  const onThumb = (up: boolean) => {
    setThumb(up);
    // Flipping back to 👍 clears both the reason and the note — positive
    // feedback carries neither.
    const r = up ? null : reason;
    const n = up ? null : note;
    if (up) {
      setReason(null);
      setNote(null);
    }
    persist(up, r, n);
  };

  const onReason = (r: string) => {
    setReason(r);
    persist(false, r, note);
  };

  const onNote = (n: string) => {
    // Guard against a stray blur after the user has flipped back to 👍.
    if (thumb !== false) return;
    const value = n.length > 0 ? n : null;
    setNote(value);
    persist(false, reason, value);
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName="gap-5 px-6 py-6"
        // When the feedback-note keyboard opens it must not hide the note field
        // or the Done button: inset the scroll content for the keyboard (iOS) so
        // everything below scrolls into view, keep taps working while it's open
        // (default "never" would swallow the first tap on a button just to
        // dismiss the keyboard), and let a downward swipe dismiss it.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <FirstResultCelebration
          sessionCount={sessionCount}
          celebrate={celebrate}
        />

        <Text variant="caption">YOUR ONE CUE</Text>
        <Card className="border border-accent">
          <Text variant="cue">{latestResult.coachingCue}</Text>
          <Text variant="caption" className="mt-3">
            Target: {latestResult.targetPosition}
          </Text>
        </Card>

        {!isDemoMode ? (
          <Pressable
            testID="output-review-transcript"
            accessibilityRole="button"
            accessibilityLabel="Review transcript"
            hitSlop={8}
            onPress={() => router.push(`/session/${latestResult.sessionId}`)}
          >
            <Text variant="caption" className="text-primary">
              Cue seem off? Review transcript →
            </Text>
          </Pressable>
        ) : null}

        <Card className="gap-2">
          <Text variant="heading">Session summary</Text>
          <Text variant="body">{latestResult.structuredSummary}</Text>
          <Text variant="caption" className="mt-2">
            Mood: {latestResult.sentiment}
          </Text>
        </Card>

        <FeedbackControls
          thumb={thumb}
          reason={reason}
          note={note}
          onThumb={onThumb}
          onReason={onReason}
          onNote={onNote}
        />

        <Button
          title="Done"
          onPress={() => {
            reset();
            router.replace('/(tabs)/record');
          }}
        />
        <Button
          title="View log"
          variant="ghost"
          onPress={() => router.replace('/(tabs)/log')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
