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
  /** Issue #48 — which side of the position the practitioner was on. */
  perspective: 'top' | 'bottom' | 'unknown';
  /** Explicit gi/no-gi statement, or 'unknown' (#60). */
  statedGi: 'gi' | 'no-gi' | 'unknown';
}

/** A distilled mechanic from the serving store (#57). No source link by design. */
export interface CoachingRecord {
  id: string;
  position: string;
  prescription: string;
  why: string;
  detail: string;
  counter: string;
  gi: string;
  level: string;
  opponent: string;
  certified: boolean;
  contested: boolean;
  /** Two or more reviewers agree it is wrong (#77). */
  rejected: boolean;
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
  /**
   * Attire for this session (#43): 'gi' | 'no-gi', or absent/null when the
   * client did not capture it. Never inferred from the transcript — 78% of
   * baseline recordings never say which it was.
   */
  gi?: string | null;
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
  /** Canonical position id (issue #47/#48). Null when undetermined. */
  targetPositionId: string | null;
  sentiment: string;
  qualityGatePassed: boolean;
  processingSteps: ProcessingStep[];
  declined: boolean;
  declinedReason: string;
}
