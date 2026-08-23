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
  /**
   * Idempotency key for the in-flight take: generated once per accepted
   * recording (submitReview), sent with every pipeline invoke so a
   * timeout-then-retry can never create two sessions from one recording.
   */
  clientSessionId: string | null;
  /**
   * Storage path of the successfully-uploaded audio for the in-flight take.
   * Lets "Try again" skip re-uploading (and re-orphaning) the audio when only
   * the analyze step failed.
   */
  uploadedAudioPath: string | null;
  steps: ProcessingStep[];
  latestResult: PipelineOutput | null;
  history: Session[];
  errorMessage: string | null;
  /**
   * False when retrying cannot possibly help (a provider spend cap, a rejected
   * key). The processing screen demotes its retry control accordingly.
   */
  errorRetryable: boolean;
  /**
   * Consecutive takes the pipeline has declined (issue #44). Drives the
   * reworded second decline — someone whose retry also failed needs an exit,
   * not the advice repeated. Survives `reset()` so a re-record keeps counting;
   * cleared automatically as soon as a take produces a real cue.
   */
  declineStreak: number;

  setStatus: (status: RecordingStatus) => void;
  setAudioUri: (uri: string | null) => void;
  setClientSessionId: (id: string | null) => void;
  setUploadedAudioPath: (path: string | null) => void;
  setSteps: (steps: ProcessingStep[]) => void;
  setLatestResult: (result: PipelineOutput | null) => void;
  setHistory: (history: Session[]) => void;
  removeSession: (sessionId: string) => void;
  /** Replace a cached session in place (e.g. after re-analysis) if present. */
  replaceSession: (session: Session) => void;
  setFeedback: (
    sessionId: string,
    thumbsUp: boolean,
    reason?: string | null,
    note?: string | null,
  ) => void;
  setError: (message: string | null, retryable?: boolean) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'idle',
  audioUri: null,
  clientSessionId: null,
  uploadedAudioPath: null,
  steps: [],
  latestResult: null,
  history: [],
  errorMessage: null,
  errorRetryable: true,
  declineStreak: 0,

  setStatus: (status) => set({ status }),
  setAudioUri: (audioUri) => set({ audioUri }),
  setClientSessionId: (clientSessionId) => set({ clientSessionId }),
  setUploadedAudioPath: (uploadedAudioPath) => set({ uploadedAudioPath }),
  setSteps: (steps) => set({ steps }),
  setLatestResult: (latestResult) =>
    set((state) => ({
      latestResult,
      declineStreak: latestResult
        ? latestResult.declined
          ? state.declineStreak + 1
          : 0
        : state.declineStreak,
    })),
  setHistory: (history) => set({ history }),
  removeSession: (sessionId) =>
    set((state) => ({
      history: state.history.filter((s) => s.id !== sessionId),
    })),
  replaceSession: (session) =>
    set((state) => ({
      history: state.history.map((s) => (s.id === session.id ? session : s)),
    })),
  setFeedback: (sessionId, thumbsUp, reason, note) =>
    set((state) => ({
      history: state.history.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              thumbsUp,
              feedbackReason: reason ?? null,
              feedbackNote: note ?? null,
            }
          : s,
      ),
    })),
  setError: (errorMessage, retryable = true) =>
    set({
      errorMessage,
      errorRetryable: retryable,
      status: errorMessage ? 'error' : 'idle',
    }),
  reset: () =>
    set({
      status: 'idle',
      audioUri: null,
      clientSessionId: null,
      uploadedAudioPath: null,
      steps: [],
      latestResult: null,
      errorMessage: null,
      errorRetryable: true,
    }),
}));
