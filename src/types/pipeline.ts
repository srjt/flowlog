import type { ISportContext } from '@/sports/ISportContext';
import type { SportKey } from '@/types/sport';
import type { SkillLevel } from '@/types/user';

/**
 * Pipeline & AI contract types.
 *
 * These are the single source of truth for the shapes that flow between the
 * pipeline, the services, and the provider interfaces. Provider interface
 * files import from here rather than redefining shapes.
 */

// ── Transcription ───────────────────────────────────────────────────────────
export interface TranscriptionResult {
  transcript: string;
  confidence: number;
  detectedTerms: string[];
  durationSeconds: number;
}

// ── Extraction (Stage 1) ────────────────────────────────────────────────────
export interface ExtractionInput {
  transcript: string;
  sportContext: ISportContext;
  beltLevel: string;
}

export interface ExtractionOutput {
  positionsVisited: string[];
  keyMistake: string;
  opponentAction: string;
  sentiment: string;
  rawTranscript: string;
}

// ── Coaching (Stage 2) ──────────────────────────────────────────────────────
export interface CoachingInput {
  extraction: ExtractionOutput;
  sportContext: ISportContext;
  recentMistakes: string[];
  skillLevel: string;
  dominantWeakness: string | null;
  /**
   * When true, the provider appends a stricter instruction (shorter, more
   * specific, no generic filler). Set by CoachingService on a quality-gate
   * retry. Optional so normal calls stay unchanged.
   */
  strict?: boolean;
}

export interface CoachingOutput {
  cue: string; // MAX 25 words — enforced in CoachingService and the AI prompt.
  targetPosition: string;
  confidenceScore: number;
  isGeneric: boolean;
}

// ── Quality gate ────────────────────────────────────────────────────────────
export interface QualityGateResult {
  passed: boolean;
  coaching: CoachingOutput;
  attempts: number;
  failureReasons: string[];
  usedFallback: boolean;
}

// ── Pipeline orchestration ──────────────────────────────────────────────────
export type ProcessingStepName =
  | 'context'
  | 'transcription'
  | 'extraction'
  | 'coaching'
  | 'quality_gate'
  | 'persistence';

export type ProcessingStepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ProcessingStep {
  name: ProcessingStepName;
  label: string;
  status: ProcessingStepStatus;
  startedAt?: number;
  finishedAt?: number;
  detail?: string;
}

export interface PipelineInput {
  audioUri: string;
  userId: string;
  sportKey: SportKey;
  skillLevel: SkillLevel;
  sessionDate: Date;
}

export interface PipelineOutput {
  sessionId: string;
  structuredSummary: string;
  coachingCue: string;
  targetPosition: string;
  sentiment: string;
  qualityGatePassed: boolean;
  processingSteps: ProcessingStep[];
}
