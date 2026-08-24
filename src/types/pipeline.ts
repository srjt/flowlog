import type { ISportContext } from '@/sports/ISportContext';
import type { Perspective } from '@/sports/positionTypes';
import type { SportKey } from '@/types/sport';
import type { GiPreference, SkillLevel } from '@/types/user';

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
  /**
   * Whether the transcript actually described something coachable (issue #44).
   * The model judges this; `ExtractionService` additionally applies a word-count
   * backstop, so a `false` here can come from either. When false the pipeline
   * declines: coaching never runs and no cue is invented.
   */
  hasCoachableContent: boolean;
  /** Short phrase describing what was missing. Empty when content is sufficient. */
  insufficientReason: string;
  /**
   * Which side of the position the practitioner was on, for the situation the
   * key mistake happened in (issue #48). `'unknown'` when the transcript never
   * says — never a guess, because a wrong side produces confident coaching
   * aimed at the opposite situation.
   */
  perspective: Perspective | 'unknown';
}

// ── Grounding (Stage 2a½) ───────────────────────────────────────────────────
/**
 * A distilled instructional mechanic from the serving store, used to ground a
 * cue (issue #41/#57).
 *
 * Deliberately carries NO link to the material it was derived from — no
 * instructor, title, volume, timestamp or verbatim quote. Provenance lives only
 * on the authoring machine (see #37).
 */
export interface CoachingRecord {
  id: string;
  /** Canonical position id — perspective is part of the identity. */
  position: string;
  /** What to do, or not do. The mistake is its negative half. */
  prescription: string;
  /** Why it works, or why the alternative fails. Carries the depth. */
  why: string;
  detail: string;
  counter: string;
  /** Conditions under which the prescription holds. */
  gi: string;
  level: string;
  opponent: string;
  /** Human-review gates. Nothing is certified yet; see #41. */
  certified: boolean;
  contested: boolean;
}

// ── Coaching (Stage 2) ──────────────────────────────────────────────────────
export interface CoachingInput {
  extraction: ExtractionOutput;
  sportContext: ISportContext;
  recentMistakes: string[];
  skillLevel: string;
  dominantWeakness: string | null;
  /**
   * Instructional records placed in front of the model as it writes (#57).
   * Empty when the session could not be grounded — the cue is then produced
   * exactly as it was before, with no user-visible difference.
   */
  groundingRecords?: CoachingRecord[];
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
  /** Attire for this session (#43). Null means unknown. */
  gi?: GiPreference | null;
  /**
   * Idempotency key generated once per accepted take. The server refuses to
   * create a second session for the same (user, key), so retries are safe.
   */
  clientSessionId?: string | null;
  /**
   * Storage path from an earlier successful upload of this same take. When
   * set, the upload step is skipped — retries reuse the audio already there.
   */
  uploadedAudioPath?: string | null;
}

/**
 * Input to re-analysis: the user corrected a saved Session's transcript and
 * wants its cue regenerated in place. No audio — analysis runs on the edited
 * text directly, then the existing Session row is updated (never a new row).
 */
export interface ReanalyzeInput {
  sessionId: string;
  userId: string;
  sportKey: SportKey;
  skillLevel: SkillLevel;
  editedTranscript: string;
}

export interface PipelineOutput {
  sessionId: string;
  structuredSummary: string;
  /**
   * Null when the pipeline declined (issue #44) — there was nothing coachable in
   * the recording, so no cue was generated rather than one being invented.
   * The Session is still saved; the UI renders an honest empty state.
   */
  coachingCue: string | null;
  targetPosition: string | null;
  /**
   * Canonical position id (issue #47/#48), e.g. `side-control-bottom`. Null
   * when the position or the side could not be determined — callers key on
   * this and abstain rather than falling back to the free-text label.
   */
  targetPositionId: string | null;
  sentiment: string;
  qualityGatePassed: boolean;
  processingSteps: ProcessingStep[];
  /** True when the pipeline declined to produce a cue. */
  declined: boolean;
  /** Why it declined — shown to the user as context. Empty unless `declined`. */
  declinedReason: string;
}
