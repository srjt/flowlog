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
  /**
   * The user-reviewed/corrected transcript for the in-flight take (set on the
   * transcript screen). Passed to analysis so coaching uses what they meant.
   */
  editedTranscript: string | null;
  steps: ProcessingStep[];
  latestResult: PipelineOutput | null;
  history: Session[];
  errorMessage: string | null;

  setStatus: (status: RecordingStatus) => void;
  setAudioUri: (uri: string | null) => void;
  setClientSessionId: (id: string | null) => void;
  setUploadedAudioPath: (path: string | null) => void;
  setEditedTranscript: (transcript: string | null) => void;
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
  clientSessionId: null,
  uploadedAudioPath: null,
  editedTranscript: null,
  steps: [],
  latestResult: null,
  history: [],
  errorMessage: null,

  setStatus: (status) => set({ status }),
  setAudioUri: (audioUri) => set({ audioUri }),
  setClientSessionId: (clientSessionId) => set({ clientSessionId }),
  setUploadedAudioPath: (uploadedAudioPath) => set({ uploadedAudioPath }),
  setEditedTranscript: (editedTranscript) => set({ editedTranscript }),
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
      clientSessionId: null,
      uploadedAudioPath: null,
      editedTranscript: null,
      steps: [],
      latestResult: null,
      errorMessage: null,
    }),
}));
