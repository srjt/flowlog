import { router, Stack, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedbackControls } from '@/components/FeedbackControls';
import { Button, Card, Text } from '@/components/ui';
import { isDemoMode } from '@/config/featureFlags';
import { useReanalyze } from '@/hooks/useReanalyze';
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { state: reanalyzeState, reanalyze } = useReanalyze();

  useEffect(() => {
    if (session || !id) return;
    loadSessions(authUser?.id ?? 'demo-user', activeSport)
      .then((list) => setSession(list.find((s) => s.id === id) ?? null))
      .catch((err) => logger.warn('session load failed', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const persist = (up: boolean, reason: string | null, note: string | null) => {
    if (!session) return;
    setSession({
      ...session,
      thumbsUp: up,
      feedbackReason: reason,
      feedbackNote: note,
    });
    useSessionStore.getState().setFeedback(session.id, up, reason, note);
    saveSessionFeedback(session.id, up, reason, note).catch((err) =>
      logger.warn('feedback save failed', err),
    );
  };
  // Flipping to 👍 clears both; flipping to 👎 keeps whatever was saved.
  const onThumb = (up: boolean) =>
    up
      ? persist(true, null, null)
      : persist(
          false,
          session?.feedbackReason ?? null,
          session?.feedbackNote ?? null,
        );
  const onReason = (reason: string) =>
    persist(false, reason, session?.feedbackNote ?? null);
  const onNote = (note: string) => {
    // Note only applies to a 👎; ignore a stray blur after a flip to 👍.
    if (session?.thumbsUp !== false) return;
    persist(
      false,
      session?.feedbackReason ?? null,
      note.length > 0 ? note : null,
    );
  };

  const onShare = async () => {
    if (!session) return;
    try {
      await Share.share({ message: shareText(session) });
    } catch (err) {
      logger.warn('share failed', err);
    }
  };

  // Both entry points (Log tab, post-recording Result) push onto this route,
  // so back() returns correctly. Named (not an inline closure) so the header
  // back control is exercisable at the test seam.
  const onBack = () => router.back();

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

  const startEdit = () => {
    if (!session) return;
    setDraft(session.rawTranscript ?? '');
    setEditing(true);
  };

  const onReanalyze = async () => {
    if (!session) return;
    const text = draft.trim();
    if (!text) return;
    const result = await reanalyze({
      sessionId: session.id,
      sportKey: session.sportKey,
      editedTranscript: text,
    });
    if (!result) return; // the hook surfaced a friendly error
    // The whole breakdown (positions, key mistake…) changed server-side, so
    // reload the fresh row rather than patching just the cue.
    try {
      const fresh = (
        await loadSessions(authUser?.id ?? 'demo-user', session.sportKey)
      ).find((s) => s.id === session.id);
      const next: Session = fresh ?? {
        ...session,
        rawTranscript: text,
        coachingCue: result.coachingCue,
        targetPosition: result.targetPosition,
        sentiment: result.sentiment,
      };
      setSession(next);
      useSessionStore.getState().replaceSession(next);
    } catch (err) {
      logger.warn('reanalyze refresh failed', err);
    }
    setEditing(false);
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
          // iOS otherwise inherits the previous route's name ("(tabs)") as the
          // back title; force a human label. The explicit headerLeft also fixes
          // the dead-tap and gives a ≥44px, screen-reader-labelled target on
          // both platforms.
          headerBackTitle: 'Back',
          headerLeft: () => (
            <Pressable
              testID="session-back"
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={12}
              onPress={onBack}
              className="px-2 py-1"
            >
              <Text variant="body" className="text-primary">
                ‹ Back
              </Text>
            </Pressable>
          ),
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
        <ScrollView
          contentContainerClassName="gap-5 px-6 pb-8 pt-4"
          // Keep the feedback note and the transcript editor (and their submit
          // controls) reachable when the keyboard is open: inset scroll content
          // for the keyboard (iOS), and keep taps working while it's up so the
          // first tap on a button isn't swallowed just to dismiss the keyboard.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
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

          <Card className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text variant="heading">Transcript</Text>
              {!isDemoMode && !editing ? (
                <Pressable
                  testID="transcript-edit"
                  accessibilityRole="button"
                  accessibilityLabel="Edit transcript"
                  hitSlop={8}
                  onPress={startEdit}
                >
                  <Text variant="caption" className="text-primary">
                    Edit
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {editing ? (
              <View className="gap-3">
                <Text variant="caption">
                  Fix any mis-heard words, then re-analyze to update your cue.
                </Text>
                <TextInput
                  testID="transcript-edit-input"
                  className="min-h-40 rounded-xl bg-background px-4 py-3 text-base text-white"
                  multiline
                  textAlignVertical="top"
                  placeholder="Your reflection…"
                  placeholderTextColor="#8A8A99"
                  accessibilityLabel="Edit transcript"
                  value={draft}
                  onChangeText={setDraft}
                  editable={reanalyzeState.status !== 'running'}
                />
                {reanalyzeState.status === 'error' ? (
                  <Text variant="caption" className="text-danger">
                    {reanalyzeState.message}
                  </Text>
                ) : null}
                <View className="flex-row gap-3">
                  <Button
                    testID="transcript-reanalyze"
                    title="Re-analyze"
                    className="flex-1"
                    loading={reanalyzeState.status === 'running'}
                    disabled={draft.trim().length === 0}
                    onPress={() => void onReanalyze()}
                  />
                  <Button
                    testID="transcript-edit-cancel"
                    title="Cancel"
                    variant="secondary"
                    className="flex-1"
                    disabled={reanalyzeState.status === 'running'}
                    onPress={() => setEditing(false)}
                  />
                </View>
              </View>
            ) : (
              <Text variant="body" className="leading-6">
                {session.rawTranscript ?? '—'}
              </Text>
            )}
          </Card>

          <FeedbackControls
            thumb={session.thumbsUp ?? null}
            reason={session.feedbackReason ?? null}
            note={session.feedbackNote ?? null}
            onThumb={onThumb}
            onReason={onReason}
            onNote={onNote}
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
