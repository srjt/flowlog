import { create } from 'zustand';

import type { PipelineOutput, ProcessingStep } from '@/types/pipeline';
import type { Session } from '@/types/session';

export type RecordingStatus =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'complete'
  | 'error';

/**
 * Session client state: the in-flight recording, live pipeline progress, the
 * latest result, and the cached history list. State only — the pipeline and
 * storage provider perform the async work and push results in here.
 */
interface SessionState {
  status: RecordingStatus;
  audioUri: string | null;
  steps: ProcessingStep[];
  latestResult: PipelineOutput | null;
  history: Session[];
  errorMessage: string | null;

  setStatus: (status: RecordingStatus) => void;
  setAudioUri: (uri: string | null) => void;
  setSteps: (steps: ProcessingStep[]) => void;
  setLatestResult: (result: PipelineOutput | null) => void;
  setHistory: (history: Session[]) => void;
  removeSession: (sessionId: string) => void;
  setFeedback: (
    sessionId: string,
    thumbsUp: boolean,
    reason?: string | null,
  ) => void;
  setError: (message: string | null) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'idle',
  audioUri: null,
  steps: [],
  latestResult: null,
  history: [],
  errorMessage: null,

  setStatus: (status) => set({ status }),
  setAudioUri: (audioUri) => set({ audioUri }),
  setSteps: (steps) => set({ steps }),
  setLatestResult: (latestResult) => set({ latestResult }),
  setHistory: (history) => set({ history }),
  removeSession: (sessionId) =>
    set((state) => ({
      history: state.history.filter((s) => s.id !== sessionId),
    })),
  setFeedback: (sessionId, thumbsUp, reason) =>
    set((state) => ({
      history: state.history.map((s) =>
        s.id === sessionId
          ? { ...s, thumbsUp, feedbackReason: reason ?? null }
          : s,
      ),
    })),
  setError: (errorMessage) =>
    set({ errorMessage, status: errorMessage ? 'error' : 'idle' }),
  reset: () =>
    set({
      status: 'idle',
      audioUri: null,
      steps: [],
      latestResult: null,
      errorMessage: null,
    }),
}));
