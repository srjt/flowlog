/**
 * Types for the cue judge (issue #61).
 *
 * Kept separate from the orchestration so the pure decision logic — the
 * sufficiency gate, the claim aggregation, the scoring — can be unit-tested
 * without a model call.
 */

/** One atomic, independently checkable assertion pulled out of a cue. */
export interface Claim {
  /** The assertion, in the judge's own words. One mechanic per claim. */
  text: string;
}

/**
 * What checking a single claim concluded.
 *
 * `unsupported` is deliberately NOT a defect. A mechanic absent from a
 * 953-record corpus mined from one instructional series is usually just
 * absent, not wrong — treating silence as contradiction is how a grounded
 * judge turns a coverage gap into a false accusation.
 */
export type ClaimStatus =
  /** The evidence (or established mechanics) backs it. */
  | 'supported'
  /** It is mechanically wrong, or impossible in the named position. */
  | 'contradicted'
  /** Sound in itself, but it does not address the mistake in hand. */
  | 'off_target'
  /** Nothing to say either way. */
  | 'unsupported';

export interface ClaimCheck {
  claim: string;
  status: ClaimStatus;
  /** One sentence. Why the status, in mechanical terms. */
  reason: string;
}

/** Whether the judge had real evidence, and therefore which mode it ran in. */
export type JudgeMode =
  /** Records survived the gate; claims were checked against them. */
  | 'grounded'
  /** Evidence was thin; claims were checked without records. */
  | 'ungrounded';

export interface CueJudgement {
  sessionId: string;
  mode: JudgeMode;
  /** How many records the gate had to work with. */
  recordsAvailable: number;
  claims: ClaimCheck[];
  /** The judge's call: is this cue defective? */
  defective: boolean;
  /** Which claim statuses drove the call. */
  rationale: string;
}

/** One cue to judge, as the frozen verdict file stores it. */
export interface JudgeSubject {
  sessionId: string;
  cue: string;
  target: string;
  keyMistake: string;
}
