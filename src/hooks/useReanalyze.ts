import { useCallback, useRef, useState } from 'react';

import { pipelineClient } from '@/pipeline/PipelineClient';
import { useUserStore } from '@/store/userStore';
import type { PipelineOutput } from '@/types/pipeline';
import type { SportKey } from '@/types/sport';
import { toFriendlyMessage } from '@/utils/friendlyError';
import { logger } from '@/utils/logger';

type ReanalyzeState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string };

/**
 * Bridges the Session-detail editor to re-analysis. The user corrects a saved
 * Session's transcript; this regenerates its cue on the edited text and updates
 * the SAME Session in place (no new session). Mirrors usePipeline's shape — auth
 * guard, in-flight guard, friendly errors.
 */
export function useReanalyze() {
  const { authUser, skillLevel } = useUserStore();
  const [state, setState] = useState<ReanalyzeState>({ status: 'idle' });
  const inFlight = useRef(false);

  const reanalyze = useCallback(
    async (args: {
      sessionId: string;
      sportKey: SportKey;
      editedTranscript: string;
    }): Promise<PipelineOutput | null> => {
      if (!authUser) {
        setState({
          status: 'error',
          message: 'You’re signed out. Please log in and try again.',
        });
        return null;
      }
      if (inFlight.current) return null;
      inFlight.current = true;
      setState({ status: 'running' });
      try {
        const result = await pipelineClient.reanalyze({
          sessionId: args.sessionId,
          userId: authUser.id,
          sportKey: args.sportKey,
          skillLevel,
          editedTranscript: args.editedTranscript,
        });
        setState({ status: 'idle' });
        return result;
      } catch (err) {
        logger.error('re-analyze failed', err); // raw stays in the logs only
        setState({ status: 'error', message: toFriendlyMessage(err) });
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [authUser, skillLevel],
  );

  return { state, reanalyze };
}
