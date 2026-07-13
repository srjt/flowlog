import { useCallback, useRef, useState } from 'react';

import { pipelineClient } from '@/pipeline/PipelineClient';
import { useSessionStore } from '@/store/sessionStore';
import { useUserStore } from '@/store/userStore';
import { toFriendlyMessage } from '@/utils/friendlyError';
import { logger } from '@/utils/logger';

type TranscribeState =
  | { status: 'loading' }
  | { status: 'ready'; transcript: string }
  | { status: 'error'; message: string };

/**
 * Phase 1 of transcript review: turn the recorded take into a transcript the
 * user can correct before analysis. Mirrors usePipeline's shape — auth guard,
 * in-flight guard, friendly errors — and persists the uploaded audio path so
 * the later analyze call (and any retry) reuses it instead of re-uploading.
 */
export function useTranscribe() {
  const { authUser, activeSport, skillLevel } = useUserStore();
  const [state, setState] = useState<TranscribeState>({ status: 'loading' });
  const inFlight = useRef(false);

  const transcribe = useCallback(
    async (audioUri: string) => {
      if (!authUser) {
        setState({
          status: 'error',
          message: 'You’re signed out. Please log in and try again.',
        });
        return;
      }
      if (inFlight.current) return;
      inFlight.current = true;
      setState({ status: 'loading' });
      try {
        const { uploadedAudioPath } = useSessionStore.getState();
        const { transcript } = await pipelineClient.transcribeAudio(
          {
            audioUri,
            userId: authUser.id,
            sportKey: activeSport,
            skillLevel,
            sessionDate: new Date(),
            uploadedAudioPath,
          },
          (path) => useSessionStore.getState().setUploadedAudioPath(path),
        );
        setState({ status: 'ready', transcript });
      } catch (err) {
        logger.error('transcribe failed', err); // raw stays in the logs only
        setState({ status: 'error', message: toFriendlyMessage(err) });
      } finally {
        inFlight.current = false;
      }
    },
    [authUser, activeSport, skillLevel],
  );

  return { state, transcribe };
}
