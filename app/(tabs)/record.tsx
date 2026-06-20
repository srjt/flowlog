import { Audio } from 'expo-av';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StreakStrip } from '@/components/StreakStrip';
import { Button, Card, Text } from '@/components/ui';
import { isDemoMode } from '@/config/featureFlags';
import { PIPELINE_CONFIG } from '@/constants/pipelineConfig';
import { useSessionTrends } from '@/hooks/useSessionTrends';
import { useSessionStore } from '@/store/sessionStore';
import { useUserStore } from '@/store/userStore';
import { logger } from '@/utils/logger';

/**
 * Screen 1 — record, then review before committing.
 *
 * States: idle → recording → (too short ⇒ keep/discard) | (valid ⇒ review).
 * - Cancel during recording discards the take and returns to idle (no pipeline).
 * - A valid take goes to a review step (duration, Play, Re-record, Submit);
 *   only Submit starts the pipeline. This gives the user control before a costly
 *   call. Recorder + playback objects are always unloaded to avoid leaks.
 */
export default function RecordScreen() {
  const [recording, setRecording] = useState(false);
  const [tooShort, setTooShort] = useState(false);
  const [review, setReview] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [reviewUri, setReviewUri] = useState<string | null>(null);
  const [reviewDuration, setReviewDuration] = useState(0);
  const [hint, setHint] = useState<string | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { setAudioUri, setStatus } = useSessionStore();
  const { activeSport, skillLevel } = useUserStore();
  const { trends, loading: trendsLoading } = useSessionTrends();
  const dominantWeakness = trends?.focusArea ?? null;
  const { minRecordingSeconds, maxRecordingSeconds } = PIPELINE_CONFIG;
  const idle = !recording && !tooShort && !review;

  // Live "is it listening?" pulse. Falls back to a static ring under reduced motion.
  const reducedMotion = useReducedMotion();
  const pulse = useSharedValue(0);
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.35 }],
    opacity: 0.45 * (1 - pulse.value),
  }));

  useEffect(() => {
    if (recording && !reducedMotion) {
      pulse.value = 0;
      pulse.value = withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, reducedMotion]);

  const runInterval = () => {
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };
  const unloadSound = async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch (err) {
        logger.warn('sound unload failed', err);
      }
      soundRef.current = null;
    }
  };
  const unloadRecorder = async () => {
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
      } catch (err) {
        logger.warn('recorder unload failed', err);
      }
      recordingRef.current = null;
    }
  };

  // Unload everything on unmount — no leaked recording/sound objects.
  useEffect(() => {
    return () => {
      stopTimer();
      void unloadSound();
      void unloadRecorder();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-stop at the max duration.
  useEffect(() => {
    if (recording && elapsed >= maxRecordingSeconds) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, recording]);

  const begin = async () => {
    setHint(null);
    setTooShort(false);
    setReview(false);
    setReviewUri(null);
    setElapsed(0);
    if (isDemoMode) {
      setRecording(true);
      setStatus('recording');
      runInterval();
      return;
    }
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setHint('Microphone permission denied. Enable it to record.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = rec;
      setRecording(true);
      setStatus('recording');
      runInterval();
    } catch (err) {
      logger.error('failed to start recording', err);
      setHint('Could not start recording on this device.');
    }
  };

  /** Stop tap. Below minimum ⇒ keep/discard prompt; otherwise ⇒ review step. */
  const finish = async () => {
    stopTimer();
    setRecording(false);

    if (elapsed < minRecordingSeconds) {
      setTooShort(true);
      if (!isDemoMode && recordingRef.current) {
        try {
          await recordingRef.current.pauseAsync();
        } catch (err) {
          logger.warn('pause failed', err);
        }
      }
      return;
    }

    const duration = elapsed;
    if (isDemoMode) {
      setReviewUri('demo://session');
      setReviewDuration(duration);
      setReview(true);
      return;
    }
    try {
      const rec = recordingRef.current;
      recordingRef.current = null;
      if (!rec) return;
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (!uri) {
        setHint('That recording didn’t capture any audio. Please try again.');
        setStatus('idle');
        return;
      }
      setReviewUri(uri);
      setReviewDuration(duration);
      setReview(true);
    } catch (err) {
      logger.error('failed to stop recording', err);
      setHint('Could not finish the recording.');
    }
  };

  /** Resume a paused (too-short) recording and keep going. */
  const keepRecording = async () => {
    setTooShort(false);
    setHint(null);
    setRecording(true);
    if (!isDemoMode && recordingRef.current) {
      try {
        await recordingRef.current.startAsync(); // resumes after pause
      } catch (err) {
        logger.warn('resume failed', err);
      }
    }
    runInterval();
  };

  /** Cancel / discard: stop, unload, back to idle. No pipeline call. */
  const discard = async () => {
    stopTimer();
    setRecording(false);
    setTooShort(false);
    setReview(false);
    setReviewUri(null);
    setElapsed(0);
    setHint(null);
    setStatus('idle');
    await unloadSound();
    await unloadRecorder();
  };

  /** Throw away the reviewed take and start a fresh capture. */
  const reRecord = async () => {
    await unloadSound();
    await unloadRecorder();
    setReview(false);
    setReviewUri(null);
    setHint(null);
    await begin();
  };

  /** Play back the reviewed take (real mode only). */
  const play = async () => {
    if (isDemoMode || !reviewUri) return;
    try {
      await unloadSound();
      const { sound } = await Audio.Sound.createAsync(
        { uri: reviewUri },
        { shouldPlay: true },
      );
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.isLoaded && s.didJustFinish) void unloadSound();
      });
    } catch (err) {
      logger.warn('playback failed', err);
      setHint('Couldn’t play that back.');
    }
  };

  /** Commit the reviewed take to the pipeline. */
  const submitReview = () => {
    if (!reviewUri) return;
    void unloadSound();
    setAudioUri(reviewUri);
    router.push('/(flow)/processing');
  };

  const toggle = () => (recording ? void finish() : void begin());

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center gap-8 px-6">
        <View className="items-center gap-1">
          <Text variant="heading">{activeSport.toUpperCase()}</Text>
          <Text variant="caption">{skillLevel}</Text>
          {dominantWeakness && idle ? (
            <View className="mt-2 rounded-full bg-accent/20 px-4 py-1">
              <Text variant="caption" className="text-accent">
                Working on: {dominantWeakness}
              </Text>
            </View>
          ) : null}
        </View>

        {review ? (
          <Card className="w-full items-center gap-4">
            <Text variant="heading">{formatTime(reviewDuration)}</Text>
            <Text variant="caption" className="text-center">
              Review your reflection, then submit when you’re happy with it.
            </Text>
            <View className="w-full flex-row gap-3">
              {!isDemoMode ? (
                <Button
                  testID="review-play"
                  title="Play"
                  variant="secondary"
                  className="flex-1"
                  onPress={() => void play()}
                />
              ) : null}
              <Button
                testID="review-rerecord"
                title="Re-record"
                variant="secondary"
                className="flex-1"
                onPress={() => void reRecord()}
              />
            </View>
            <Button
              testID="review-submit"
              title="Submit"
              className="w-full"
              onPress={submitReview}
            />
          </Card>
        ) : tooShort ? (
          <Card className="items-center gap-4 border border-accent">
            <Text variant="body" className="text-center">
              That was only {elapsed}s. Record at least {minRecordingSeconds}s
              for a useful cue.
            </Text>
            <View className="flex-row gap-3">
              <Button
                testID="record-keep"
                title="Keep recording"
                className="flex-1"
                onPress={() => void keepRecording()}
              />
              <Button
                testID="record-discard"
                title="Discard"
                variant="secondary"
                className="flex-1"
                onPress={() => void discard()}
              />
            </View>
          </Card>
        ) : (
          <>
            {idle ? (
              <View className="w-full">
                <StreakStrip trends={trends} loading={trendsLoading} />
              </View>
            ) : null}

            <View className="h-44 w-44 items-center justify-center">
              {recording && !reducedMotion ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    {
                      position: 'absolute',
                      width: '100%',
                      height: '100%',
                      borderRadius: 9999,
                      backgroundColor: '#5B8DEF',
                    },
                    ringStyle,
                  ]}
                />
              ) : null}
              {recording && reducedMotion ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    width: '120%',
                    height: '120%',
                    borderRadius: 9999,
                    borderWidth: 4,
                    borderColor: '#5B8DEF',
                    opacity: 0.5,
                  }}
                />
              ) : null}
              <Pressable
                testID="record-toggle"
                accessibilityRole="button"
                accessibilityLabel={
                  recording ? 'Stop recording' : 'Start recording'
                }
                accessibilityState={{ selected: recording, busy: recording }}
                accessibilityHint={
                  recording
                    ? 'Double tap to stop and review your reflection'
                    : 'Double tap to start a voice reflection'
                }
                onPress={toggle}
                className={`h-44 w-44 items-center justify-center rounded-full ${
                  recording ? 'bg-danger' : 'bg-primary'
                }`}
              >
                <Text variant="heading">
                  {recording ? formatTime(elapsed) : 'Record'}
                </Text>
              </Pressable>
            </View>

            <Text variant="caption" className="text-center">
              {recording
                ? 'Tap to stop'
                : `Record a ${minRecordingSeconds}–${maxRecordingSeconds}s reflection after your session.`}
            </Text>

            {recording ? (
              <Button
                testID="record-cancel"
                title="Cancel"
                variant="ghost"
                onPress={() => void discard()}
              />
            ) : null}
          </>
        )}

        {hint ? (
          <Text variant="caption" className="text-center text-accent">
            {hint}
          </Text>
        ) : null}

        {isDemoMode ? (
          <Text variant="caption" className="text-center text-muted">
            Demo mode — no microphone used.
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
