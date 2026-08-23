import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedbackControls } from '@/components/FeedbackControls';
import { FirstResultCelebration } from '@/components/FirstResultCelebration';
import { Button, Card, Text } from '@/components/ui';
import { isDemoMode } from '@/config/featureFlags';
import {
  deleteSession,
  loadSessions,
  saveSessionFeedback,
} from '@/services/sessionsSource';
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
  const { latestResult, reset, setFeedback, removeSession, declineStreak } =
    useSessionStore();
  const { authUser, activeSport } = useUserStore();
  const [thumb, setThumb] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [celebrate, setCelebrate] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const declined = latestResult?.declined ?? false;

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
        // Never celebrate an empty state — a declined first Session has no
        // cue to celebrate, and the one-time flag would be spent on it.
        if (declined) return;
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
  }, [authUser, activeSport, declined]);

  if (!latestResult) {
    return <Redirect href="/(tabs)/record" />;
  }

  // Optimistically update local state, then return the DB write's promise so
  // callers that care (the note field) can await it and surface a real result.
  const persist = (up: boolean, r: string | null, n: string | null) => {
    setFeedback(latestResult.sessionId, up, r, n); // updates the Log entry too
    return saveSessionFeedback(latestResult.sessionId, up, r, n);
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
    void persist(up, r, n).catch((err) =>
      logger.warn('feedback save failed', err),
    );
  };

  const onReason = (r: string) => {
    setReason(r);
    void persist(false, r, note).catch((err) =>
      logger.warn('feedback save failed', err),
    );
  };

  const onNote = (n: string) => {
    // Guard against a stray blur after the user has flipped back to 👍.
    if (thumb !== false) return;
    const value = n.length > 0 ? n : null;
    setNote(value);
    // Return the promise (uncaught) so the note field reflects success/failure.
    return persist(false, reason, value);
  };

  // ── Declined take (issue #44) ──────────────────────────────────────────
  // Nothing coachable in the recording, so no cue was generated rather than one
  // being invented. The Session IS saved and counts toward the streak; "Record
  // again" discards it and returns to Record. Both ways out are offered from the
  // first decline — re-recording is never the only exit.
  if (declined) {
    const again = declineStreak > 1;

    const onRecordAgain = async () => {
      setDiscarding(true);
      try {
        await deleteSession(latestResult.sessionId);
        removeSession(latestResult.sessionId);
      } catch (err) {
        // Losing the discard is survivable — the session simply stays in the
        // log with no cue. Don't trap the user on this screen for it.
        logger.warn('discarding declined session failed', err);
      }
      reset();
      router.replace('/(tabs)/record');
    };

    return (
      <SafeAreaView className="flex-1 bg-background">
        <ScrollView contentContainerClassName="gap-5 px-6 py-6">
          <Text variant="caption">NO CUE THIS TIME</Text>

          <Card className="gap-3">
            <Text variant="heading">
              {again ? 'Still not enough to work from' : 'Nothing to work from'}
            </Text>
            <Text variant="body">
              {again
                ? 'That one came up short too. It’s saved either way — you can keep it and move on.'
                : 'There wasn’t enough in this recording to pull a cue from, so we haven’t made one up.'}
            </Text>
            {latestResult.declinedReason ? (
              <Text variant="caption">
                What was missing: {latestResult.declinedReason}
              </Text>
            ) : null}
            <Text variant="caption" className="mt-1">
              Next time, try naming a position and one thing that didn’t go your
              way — even a sentence is enough.
            </Text>
          </Card>

          {again ? (
            <>
              <Button
                title="Keep it and finish"
                onPress={() => {
                  reset();
                  router.replace('/(tabs)/record');
                }}
              />
              <Button
                title="Record again"
                variant="ghost"
                disabled={discarding}
                onPress={onRecordAgain}
              />
            </>
          ) : (
            <>
              <Button
                title="Record again"
                disabled={discarding}
                onPress={onRecordAgain}
              />
              <Button
                title="Keep it anyway"
                variant="ghost"
                onPress={() => {
                  reset();
                  router.replace('/(tabs)/record');
                }}
              />
            </>
          )}

          <Text variant="caption">
            Either way this one is saved and your streak is safe.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

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
