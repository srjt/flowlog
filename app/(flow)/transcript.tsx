import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text } from '@/components/ui';
import { useTranscribe } from '@/hooks/useTranscribe';
import { useSessionStore } from '@/store/sessionStore';

/**
 * Transcript review (phase 1 of the split pipeline). After a take is submitted
 * we transcribe it server-side and show the text here for the user to correct
 * BEFORE analysis runs — so a mis-heard word never becomes a wrong coaching
 * cue. "Analyze" stores the edited text and moves to Processing (which runs the
 * analysis on it); "Re-record" discards back to Record. Reached only for the
 * real server pipeline (demo/local skip straight to Processing).
 */
export default function TranscriptScreen() {
  const audioUri = useSessionStore((s) => s.audioUri);
  const setEditedTranscript = useSessionStore((s) => s.setEditedTranscript);
  const reset = useSessionStore((s) => s.reset);
  const { state, transcribe } = useTranscribe();
  const [draft, setDraft] = useState('');

  // No take in flight (e.g. deep-linked here) — no dead end.
  useEffect(() => {
    if (!audioUri) router.replace('/(tabs)/record');
  }, [audioUri]);

  // Transcribe once when the take arrives.
  useEffect(() => {
    if (audioUri) void transcribe(audioUri);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUri]);

  // Seed the editable field once the transcript lands.
  useEffect(() => {
    if (state.status === 'ready') setDraft(state.transcript);
  }, [state]);

  const analyze = () => {
    const text = draft.trim();
    if (!text) return;
    setEditedTranscript(text);
    router.replace('/(flow)/processing');
  };

  const reRecord = () => {
    reset();
    router.replace('/(tabs)/record');
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center gap-6 px-6 py-8"
          keyboardShouldPersistTaps="handled"
        >
          {state.status === 'loading' ? (
            <View className="items-center gap-3">
              <ActivityIndicator color="#5B8DEF" size="large" />
              <Text variant="heading">Transcribing…</Text>
            </View>
          ) : state.status === 'error' ? (
            <Card className="gap-4 border border-danger">
              <Text variant="heading">Hmm, that didn’t work</Text>
              <Text variant="body">{state.message}</Text>
              <View className="flex-row gap-3">
                <Button
                  testID="transcript-retry"
                  title="Try again"
                  className="flex-1"
                  onPress={() => audioUri && void transcribe(audioUri)}
                />
                <Button
                  testID="transcript-rerecord"
                  title="Re-record"
                  variant="secondary"
                  className="flex-1"
                  onPress={reRecord}
                />
              </View>
            </Card>
          ) : (
            <View className="gap-4">
              <View className="gap-1">
                <Text variant="title">Check your transcript</Text>
                <Text variant="caption">
                  Fix any wrong words before we analyze — your coaching cue is
                  built from this.
                </Text>
              </View>
              <TextInput
                testID="transcript-input"
                className="min-h-48 rounded-xl bg-surface px-4 py-3 text-base text-white"
                multiline
                textAlignVertical="top"
                placeholder="Your reflection…"
                placeholderTextColor="#8A8A99"
                accessibilityLabel="Edit transcript"
                value={draft}
                onChangeText={setDraft}
              />
              <Button
                testID="transcript-analyze"
                title="Analyze"
                onPress={analyze}
                disabled={draft.trim().length === 0}
              />
              <Button
                testID="transcript-rerecord"
                title="Re-record"
                variant="ghost"
                onPress={reRecord}
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
