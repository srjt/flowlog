import type { SportKey } from '@/types/sport';
import type { GiSource } from '@/sports/giContext';
import type { MistakeConcerns } from '@/sports/grounding';
import type { ExtractionPerspective } from '@/types/pipeline';
import type { GiPreference } from '@/types/user';
import type { DiagramOutcome } from '@/visualization/diagramStage';
import type { Spec } from '@/visualization/grammar';

/**
 * The cue force-diagram spec and its provenance (#135 / migration 025), as
 * written. One group: every Session write sets all five together, so a spec
 * never sits beside another run's outcome or versions.
 */
export interface SessionDiagramFields {
  /**
   * Why there is or is not a spec. `null`/`undefined` means NOT RECORDED (a
   * row from before migration 025), never "no diagram".
   */
  diagramOutcome?: DiagramOutcome | null;
  /**
   * The validated spec, present exactly when `diagramOutcome` is `spec`. A
   * stored spec is re-validated against its base before it is drawn.
   */
  diagramSpec?: Spec | null;
  /** `GRAMMAR_VERSION` that validated it; set whenever a prompt was built. */
  grammarVersion?: string | null;
  /** The sport's base library version; set whenever the library was consulted. */
  baseLibraryVersion?: string | null;
  /** `SPEC_PROMPT_VERSION` of the prompt sent; set whenever one was built. */
  specPromptVersion?: string | null;
}

/**
 * Mirrors the `public.sessions` table — the core persisted entity.
 * camelCase here; the storage provider maps to/from snake_case columns.
 */
export interface Session extends SessionDiagramFields {
  id: string;
  userId: string;
  sportKey: SportKey;
  sessionDate: string;
  audioStoragePath: string | null;
  rawTranscript: string | null;
  positionsVisited: string[];
  keyMistake: string | null;
  opponentAction: string | null;
  sentiment: string | null;
  coachingCue: string | null;
  /**
   * Canonical position id (issue #48), e.g. `side-control-bottom`. Null when
   * the position or the side is undetermined — the free-text `targetPosition`
   * is a display label, not a key.
   */
  targetPositionId: string | null;
  /**
   * Attire for this session (#43). Null on rows predating the column;
   * grounding treats null as unknown and excludes gi-specific records.
   */
  gi: GiPreference | null;
  /** Where `gi` came from: the toggle, an explicit statement, or nothing (#60). */
  giSource: GiSource | null;
  /**
   * Which side of the position the athlete was on, as Extraction reported it
   * (#130 / migration 024).
   *
   * `null` means NOT RECORDED — the row predates the column — and must never be
   * read as "Extraction could not tell". That is `'unknown'`, a recorded
   * abstention. Optional because rows read before 024 is applied lack it.
   */
  perspective?: ExtractionPerspective | null;
  /**
   * What the key mistake is about, as Extraction reported it (#153 /
   * migration 027). Grounding abstained, as `not_positional`, when it said
   * `submission` or `transition`.
   *
   * `null` means NOT RECORDED — the row predates the column — and must never be
   * read as `'unknown'`, which is Extraction's recorded abstention. Optional
   * because rows read before 027 is applied lack it.
   */
  mistakeConcerns?: MistakeConcerns | null;
  targetPosition: string | null;
  qualityGatePassed: boolean;
  /**
   * Why the cue was or was not grounded, and which arm it landed in (#58).
   *
   * Read back so re-analysis can INHERIT the arm rather than re-draw it (#117):
   * the original assignment key cannot be reconstructed, so the recorded value
   * IS the assignment. See `inheritedArm` in `src/sports/experiment.ts`.
   */
  grounding?: string | null;
  /**
   * When this session was last re-analysed (#117 / migration 021). Null means
   * "not since the column existed" — NOT that it never happened.
   */
  reanalyzedAt?: string | null;
  thumbsUp: boolean | null;
  /** Reason chosen on a 👎 (single-select), or null/undefined. */
  feedbackReason?: string | null;
  /**
   * Optional free-text note on a 👎 — what was wrong / how to improve.
   * Independent of `feedbackReason`. Null/undefined when not provided.
   */
  feedbackNote?: string | null;
  pipelineVersion: string | null;
  createdAt: string;
}

/**
 * Shape written when persisting a freshly-processed session. The diagram
 * fields (#135) are written on the declined path too, as `not_attempted`.
 */
export interface NewSession extends SessionDiagramFields {
  userId: string;
  sportKey: SportKey;
  sessionDate: string;
  audioStoragePath: string | null;
  rawTranscript: string;
  positionsVisited: string[];
  keyMistake: string;
  opponentAction: string;
  sentiment: string;
  /**
   * The side Extraction reported (#130). Written on the declined path too: a
   * Take with no cue still has an Extraction. Omitted means not recorded.
   */
  perspective?: ExtractionPerspective;
  /**
   * What the key mistake is about (#153). Written on the declined path too,
   * like `perspective`. Omitted means not recorded.
   */
  mistakeConcerns?: MistakeConcerns;
  /**
   * Null when the pipeline declined to produce a cue (issue #44) — the
   * recording had nothing coachable in it. A Session with no cue is still a
   * Session: it is saved, it counts toward the streak, and it contributes
   * nothing to trends (no position, no mistake).
   */
  coachingCue: string | null;
  targetPosition: string | null;
  /** Canonical position id (issue #48). Null when undetermined. */
  targetPositionId: string | null;
  qualityGatePassed: boolean;
  pipelineVersion: string;
  /** Attire for this session (#43). */
  gi?: GiPreference | null;
  /** Where `gi` came from (#60). */
  giSource?: GiSource | null;
  /** Why the cue was or was not grounded, and which arm it landed in (#58). */
  grounding?: string | null;
  /** Records actually injected. */
  groundingRecords?: number | null;
  /** Records that matched and could have been injected — the control's counterfactual. */
  groundingAvailable?: number | null;
  /**
   * Ids of the records actually injected, in rank order.
   *
   * `undefined`/`null` means "not recorded"; `[]` means "we know nothing was
   * injected". Conflating those would make a session from before this existed
   * look like a deliberately ungrounded one.
   */
  groundingRecordIds?: string[] | null;
  /** Records found for the position BEFORE the gi filter and relevance gate (#58). */
  groundingCandidates?: number | null;
  /**
   * Records that cleared the relevance gate, BEFORE the rank cap (#119).
   *
   * `groundingAvailable` is `min(this, GROUNDING_RECORD_LIMIT)`, being the
   * length of the already-sliced set — so without this the gate's selectivity
   * is not observable. Null means not recorded, never zero.
   */
  groundingGatePassed?: number | null;
}

/**
 * Fields overwritten when a Session is re-analyzed in place (corrected
 * transcript → regenerated cue). The identity fields (user, sport, date,
 * audio) are untouched — this is the same reflection, freshly analyzed.
 *
 * The diagram fields (#135) are regenerated with the cue, or cleared to
 * `not_attempted` on a declined re-analysis, so an old spec never describes a
 * new cue. Omitting `diagramOutcome` leaves all five columns alone.
 */
export interface SessionAnalysisUpdate extends SessionDiagramFields {
  rawTranscript: string;
  positionsVisited: string[];
  keyMistake: string;
  opponentAction: string;
  sentiment: string;
  /**
   * The side of the EDITED transcript (#130). Overwrites the stored value:
   * re-analysis regenerates the Extraction, so the old side may no longer be
   * true. Omitted leaves the column alone.
   */
  perspective?: ExtractionPerspective;
  /**
   * What the EDITED transcript's key mistake is about (#153). Overwrites the
   * stored value, for the same reason as `perspective`. Omitted leaves the
   * column alone.
   */
  mistakeConcerns?: MistakeConcerns;
  /**
   * Null when the pipeline declined to produce a cue (issue #44) — the
   * recording had nothing coachable in it. A Session with no cue is still a
   * Session: it is saved, it counts toward the streak, and it contributes
   * nothing to trends (no position, no mistake).
   */
  coachingCue: string | null;
  targetPosition: string | null;
  /** Canonical position id (issue #48). Null when undetermined. */
  targetPositionId: string | null;
  qualityGatePassed: boolean;
  pipelineVersion: string;
  /**
   * When this re-analysis ran (#117 / migration 021).
   *
   * The only marker that identifies a re-analysed row: `pipelineVersion` cannot,
   * because re-analysis stamps whatever version was current at the time.
   */
  reanalyzedAt?: string | null;
  /** Attire for this session (#43). */
  gi?: GiPreference | null;
  /** Where `gi` came from (#60). */
  giSource?: GiSource | null;
  /** Why the cue was or was not grounded, and which arm it landed in (#58). */
  grounding?: string | null;
  /** Records actually injected. */
  groundingRecords?: number | null;
  /** Records that matched and could have been injected — the control's counterfactual. */
  groundingAvailable?: number | null;
  /**
   * Ids of the records actually injected, in rank order.
   *
   * `undefined`/`null` means "not recorded"; `[]` means "we know nothing was
   * injected". Conflating those would make a session from before this existed
   * look like a deliberately ungrounded one.
   */
  groundingRecordIds?: string[] | null;
  /** Records found for the position BEFORE the gi filter and relevance gate (#58). */
  groundingCandidates?: number | null;
  /**
   * Records that cleared the relevance gate, BEFORE the rank cap (#119).
   *
   * `groundingAvailable` is `min(this, GROUNDING_RECORD_LIMIT)`, being the
   * length of the already-sliced set — so without this the gate's selectivity
   * is not observable. Null means not recorded, never zero.
   */
  groundingGatePassed?: number | null;
}

/** Mirrors the `public.user_trends` table. */
export interface UserTrends {
  userId: string;
  sportKey: SportKey;
  dominantWeakness: string | null;
  positionsStruggled: Record<string, number>;
  sessionCount: number;
  streakDays: number;
  lastSessionAt: string | null;
  updatedAt: string;
}
