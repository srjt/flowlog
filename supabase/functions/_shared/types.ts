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
  coachingCue: string;
  targetPosition: string;
  sentiment: string;
  qualityGatePassed: boolean;
  /** Public URL of the generated cue image, or null when absent (ADR 0012). */
  cueImageUrl?: string | null;
  processingSteps: ProcessingStep[];
}
