import { useCallback, useRef } from 'react';

import { isDemoMode } from '@/config/featureFlags';
import { demoSessionFromOutput } from '@/pipeline/demoData';
import { pipelineClient } from '@/pipeline/PipelineClient';
import { useSessionStore } from '@/store/sessionStore';
import { useUserStore } from '@/store/userStore';
import { classifyError } from '@/utils/friendlyError';
import { logger } from '@/utils/logger';

/**
 * Bridges UI -> pipeline. Screens call `process(audioUri)`; this hook runs the
 * pipeline and streams step progress + the final result into the session store.
 *
 * - The raw error is only logged; the store gets a friendly message.
 * - An in-flight guard makes the call idempotent, so a quick "Try again" can't
 *   kick off two runs (and two sessions) at once.
 */
export function usePipeline() {
  const { authUser, activeSport, skillLevel } = useUserStore();
  const { setStatus, setSteps, setLatestResult, setError } = useSessionStore();
  const inFlight = useRef(false);

  const process = useCallback(
    async (audioUri: string) => {
      if (!authUser) {
        setError('You’re signed out. Please log in and try again.');
        return null;
      }
      if (inFlight.current) return null;
      inFlight.current = true;

      setError(null);
      setStatus('processing');
      try {
        // Read the take's idempotency state at call time (set by submitReview)
        // so "Try again" reuses the same key and the already-uploaded audio.
        const { clientSessionId, uploadedAudioPath, gi } =
          useSessionStore.getState();
        const result = await pipelineClient.run(
          {
            audioUri,
            userId: authUser.id,
            sportKey: activeSport,
            skillLevel,
            sessionDate: new Date(),
            gi,
            clientSessionId,
            uploadedAudioPath,
          },
          (steps) => setSteps(steps),
          (path) => useSessionStore.getState().setUploadedAudioPath(path),
        );
        setLatestResult(result);
        // In demo mode, prepend the new session so the Log reflects it live.
        if (isDemoMode) {
          const store = useSessionStore.getState();
          store.setHistory([
            demoSessionFromOutput(authUser.id, activeSport, result),
            ...store.history,
          ]);
        }
        setStatus('complete');
        return result;
      } catch (err) {
        logger.error('pipeline run failed', err); // raw stays in the logs only
        const { message, retryable } = classifyError(err);
        setError(message, retryable);
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [
      authUser,
      activeSport,
      skillLevel,
      setStatus,
      setSteps,
      setLatestResult,
      setError,
    ],
  );

  return { process };
}
