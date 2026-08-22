// Shared types for the edge-function pipeline. These mirror the client types in
// `src/types/pipeline.ts` (kept in sync intentionally — the client and server
// speak the same wire shapes).

export interface TranscriptionResult {
  transcript: string;
  confidence: number;
  detectedTerms: string[];
  durationSeconds: number;
}

export interface ExtractionOutput {
  positionsVisited: string[];
  keyMistake: string;
  opponentAction: string;
  sentiment: string;
  rawTranscript: string;
  /** Issue #44 — see src/services/ExtractionService.ts for the full rationale. */
  hasCoachableContent: boolean;
  insufficientReason: string;
}

export interface CoachingOutput {
  cue: string;
  targetPosition: string;
  confidenceScore: number;
  isGeneric: boolean;
}

export interface ProcessingStep {
  name: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
}

export interface ProcessRequest {
  audioStoragePath: string;
  sportKey: string;
  skillLevel: string;
  sessionDate: string;
  /** Client-generated idempotency key (uuid); one per accepted take. */
  clientSessionId?: string | null;
  /**
   * Re-analysis: the id of an existing session to update in place. When set
   * (with editedTranscript), the function skips audio/transcription and
   * overwrites that row's analysis instead of inserting a new session.
   */
  reanalyzeSessionId?: string | null;
  /** The user-corrected transcript to analyze (required for re-analysis). */
  editedTranscript?: string | null;
}

export interface PipelineOutput {
  sessionId: string;
  structuredSummary: string;
  /** Null when the pipeline declined (issue #44) — no cue was invented. */
  coachingCue: string | null;
  targetPosition: string | null;
  sentiment: string;
  qualityGatePassed: boolean;
  processingSteps: ProcessingStep[];
  declined: boolean;
  declinedReason: string;
}
