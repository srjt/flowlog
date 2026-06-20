import { router } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text } from '@/components/ui';
import { usePipeline } from '@/hooks/usePipeline';
import { useSessionStore } from '@/store/sessionStore';
import type { ProcessingStep } from '@/types/pipeline';

/**
 * Pipeline loading state. Runs the pipeline for the recorded audio and renders
 * live step progress. On success it routes to Result; on failure it shows a
 * friendly message with "Try again" (re-runs the same audio — no re-recording,
 * no duplicate session) and "Discard" (clears state, back to Record). If reached
 * without a recording it redirects to Record — no dead end.
 */
export default function ProcessingScreen() {
  const { audioUri, steps, status, errorMessage, reset } = useSessionStore();
  const { process } = usePipeline();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runPipeline = useCallback(async () => {
    if (!audioUri) return;
    const result = await process(audioUri);
    if (mounted.current && result) router.replace('/(flow)/output');
  }, [audioUri, process]);

  useEffect(() => {
    if (!audioUri) {
      router.replace('/(tabs)/record');
      return;
    }
    void runPipeline();
    // Run once when the audio clip arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUri]);

  const onDiscard = () => {
    reset();
    router.replace('/(tabs)/record');
  };

  const isError = status === 'error';
  const allDone = steps.length > 0 && steps.every((s) => s.status === 'done');

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 justify-center gap-6 px-6">
        <View className="items-center gap-3">
          {isError ? (
            <Text variant="heading">Hmm, that didn’t work</Text>
          ) : allDone ? (
            <Text variant="heading">Done</Text>
          ) : (
            <>
              <ActivityIndicator color="#5B8DEF" size="large" />
              <Text variant="heading">Analyzing your session</Text>
            </>
          )}
        </View>

        {isError ? (
          <Card className="gap-4 border border-danger">
            <Text variant="body">
              {errorMessage ??
                'Something went wrong analyzing your session. Tap Try again.'}
            </Text>
            <View className="flex-row gap-3">
              <Button
                title="Try again"
                className="flex-1"
                onPress={() => void runPipeline()}
              />
              <Button
                title="Discard"
                variant="secondary"
                className="flex-1"
                onPress={onDiscard}
              />
            </View>
          </Card>
        ) : (
          <Card className="gap-3">
            {steps.length === 0 ? (
              <View className="flex-row items-center gap-3">
                <ActivityIndicator color="#8A8A99" />
                <Text variant="caption">Starting…</Text>
              </View>
            ) : (
              steps.map((step) => <StepRow key={step.name} step={step} />)
            )}
          </Card>
        )}
      </View>
    </SafeAreaView>
  );
}

function StepRow({ step }: { step: ProcessingStep }) {
  const done = step.status === 'done';
  const running = step.status === 'running';
  const failed = step.status === 'failed';

  return (
    <View className="flex-row items-center gap-3">
      {running ? (
        <ActivityIndicator color="#5B8DEF" />
      ) : (
        <View
          className={`h-5 w-5 items-center justify-center rounded-full ${
            done
              ? 'bg-success'
              : failed
                ? 'bg-danger'
                : 'bg-surface border border-muted'
          }`}
        >
          <Text variant="caption" className="text-white">
            {done ? '✓' : failed ? '✕' : ''}
          </Text>
        </View>
      )}
      <Text
        variant="body"
        className={done || running ? 'text-white' : 'text-muted'}
      >
        {step.label}
      </Text>
    </View>
  );
}
