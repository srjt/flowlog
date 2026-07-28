import { router, Stack, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedbackControls } from '@/components/FeedbackControls';
import { Button, Card, Text } from '@/components/ui';
import {
  deleteSession,
  loadSessions,
  saveSessionFeedback,
} from '@/services/sessionsSource';
import { useSessionStore } from '@/store/sessionStore';
import { useUserStore } from '@/store/userStore';
import type { Session } from '@/types/session';
import { logger } from '@/utils/logger';

/**
 * Session detail — the full record behind a Log entry: the cue, the structured
 * extraction (positions, key mistake, opponent action, sentiment), the
 * transcript, and editable thumbs feedback. Uses a native stack header (standard
 * ≥44px back affordance) plus Share and Delete actions.
 */
export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { authUser, activeSport } = useUserStore();
  const [session, setSession] = useState<Session | null>(
    () => useSessionStore.getState().history.find((s) => s.id === id) ?? null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (session || !id) return;
    loadSessions(authUser?.id ?? 'demo-user', activeSport)
      .then((list) => setSession(list.find((s) => s.id === id) ?? null))
      .catch((err) => logger.warn('session load failed', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const persist = (up: boolean, reason: string | null) => {
    if (!session) return;
    setSession({ ...session, thumbsUp: up, feedbackReason: reason });
    useSessionStore.getState().setFeedback(session.id, up, reason);
    saveSessionFeedback(session.id, up, reason).catch((err) =>
      logger.warn('feedback save failed', err),
    );
  };
  const onThumb = (up: boolean) =>
    persist(up, up ? null : (session?.feedbackReason ?? null));
  const onReason = (reason: string) => persist(false, reason);

  const onShare = async () => {
    if (!session) return;
    try {
      await Share.share({ message: shareText(session) });
    } catch (err) {
      logger.warn('share failed', err);
    }
  };

  const onDelete = async () => {
    if (!session || deleting) return;
    setDeleting(true);
    try {
      await deleteSession(session.id);
      useSessionStore.getState().removeSession(session.id);
      router.back();
    } catch (err) {
      logger.warn('delete session failed', err);
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Session',
          headerStyle: { backgroundColor: '#0B0B0F' },
          headerTintColor: '#FFFFFF',
          headerShadowVisible: false,
          headerRight: () =>
            session ? (
              <Pressable
                testID="session-share"
                accessibilityRole="button"
                accessibilityLabel="Share session"
                hitSlop={12}
                onPress={() => void onShare()}
                className="px-2 py-1"
              >
                <Text variant="body" className="text-primary">
                  Share
                </Text>
              </Pressable>
            ) : null,
        }}
      />

      {!session ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="caption">Session not found.</Text>
        </View>
      ) : (
        <ScrollView contentContainerClassName="gap-5 px-6 pb-8 pt-4">
          <Text variant="caption" className="text-white">
            {new Date(session.sessionDate).toLocaleDateString()} ·{' '}
            {session.sportKey.toUpperCase()}
          </Text>

          <Card className="border border-accent">
            <Text variant="caption">COACHING CUE</Text>
            <Text variant="cue" className="mt-1">
              {session.coachingCue ?? '—'}
            </Text>
            {session.targetPosition ? (
              <Text variant="caption" className="mt-3">
                Target: {session.targetPosition}
              </Text>
            ) : null}
          </Card>

          <Card className="gap-3">
            <Text variant="heading">Breakdown</Text>
            <Field label="Positions">
              {session.positionsVisited.length > 0 ? (
                <View className="flex-row flex-wrap gap-2">
                  {session.positionsVisited.map((p) => (
                    <View
                      key={p}
                      className="rounded-full bg-background px-3 py-1"
                    >
                      <Text variant="caption" className="text-white">
                        {p}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text variant="body">none noted</Text>
              )}
            </Field>
            <Field label="Key mistake">
              <Text variant="body">{session.keyMistake ?? '—'}</Text>
            </Field>
            <Field label="Opponent / challenge">
              <Text variant="body">{session.opponentAction ?? '—'}</Text>
            </Field>
            <Field label="Mood">
              <Text variant="body">{session.sentiment ?? '—'}</Text>
            </Field>
          </Card>

          {session.rawTranscript ? (
            <Card className="gap-2">
              <Text variant="heading">Transcript</Text>
              <Text variant="body" className="leading-6">
                {session.rawTranscript}
              </Text>
            </Card>
          ) : null}

          <FeedbackControls
            thumb={session.thumbsUp ?? null}
            reason={session.feedbackReason ?? null}
            onThumb={onThumb}
            onReason={onReason}
          />

          {confirmDelete ? (
            <Card className="gap-3 border border-danger">
              <Text variant="body">
                Delete this session? This can’t be undone.
              </Text>
              <View className="flex-row gap-3">
                <Button
                  testID="session-delete-confirm"
                  title="Delete"
                  loading={deleting}
                  className="flex-1 bg-danger"
                  onPress={() => void onDelete()}
                />
                <Button
                  testID="session-delete-cancel"
                  title="Cancel"
                  variant="secondary"
                  className="flex-1"
                  onPress={() => setConfirmDelete(false)}
                />
              </View>
            </Card>
          ) : (
            <Button
              testID="session-delete"
              title="Delete session"
              variant="ghost"
              onPress={() => setConfirmDelete(true)}
            />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** Build a shareable plain-text snippet for a session. */
function shareText(s: Session): string {
  const lines = [`Flowlog — ${s.sportKey.toUpperCase()} reflection`];
  if (s.coachingCue) lines.push(`Cue: ${s.coachingCue}`);
  if (s.targetPosition) lines.push(`Target: ${s.targetPosition}`);
  if (s.keyMistake) lines.push(`Worked on: ${s.keyMistake}`);
  return lines.join('\n');
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-1">
      <Text variant="caption">{label}</Text>
      {children}
    </View>
  );
}
